from typing import Any, Dict, List, Optional

from bson import ObjectId

from backend.app.modules.questionnaires.repository import SurveyRepository
from backend.app.modules.statistics.repository import StatisticsRepository


class StatisticsNotFound(Exception):
    pass


def _object_id(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise StatisticsNotFound
    return ObjectId(value)


class StatisticsService:
    def __init__(
        self,
        surveys: SurveyRepository,
        responses: StatisticsRepository,
    ):
        self._surveys = surveys
        self._responses = responses

    def get_survey_statistics(
        self, survey_id: str, owner_id: ObjectId
    ) -> Dict[str, Any]:
        survey = self._find_owned_survey(survey_id, owner_id)
        question_stats = self._aggregate_questions(survey, survey["questions"])
        return {
            "survey_id": str(survey["_id"]),
            "title": survey["title"],
            "status": survey["status"],
            "submitted_count": self._responses.count_submitted(survey["_id"]),
            "questions": question_stats,
        }

    def get_question_statistics(
        self, survey_id: str, question_id: str, owner_id: ObjectId
    ) -> Dict[str, Any]:
        survey = self._find_owned_survey(survey_id, owner_id)
        question = next(
            (
                item
                for item in survey.get("questions", [])
                if item.get("question_id") == question_id
            ),
            None,
        )
        if question is None:
            raise StatisticsNotFound
        stats = self._aggregate_questions(
            survey, [question], filter_question_id=question_id
        )[0]
        return {
            "survey_id": str(survey["_id"]),
            "title": survey["title"],
            "submitted_count": self._responses.count_submitted(survey["_id"]),
            "question": stats,
        }

    def _find_owned_survey(
        self, survey_id: str, owner_id: ObjectId
    ) -> Dict[str, Any]:
        survey = self._surveys.find_owned(_object_id(survey_id), owner_id)
        if survey is None:
            raise StatisticsNotFound
        return survey

    def _aggregate_questions(
        self,
        survey: Dict[str, Any],
        questions: List[Dict[str, Any]],
        *,
        filter_question_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        question_ids = {question["question_id"] for question in questions}
        stats_by_id = {
            question["question_id"]: self._initial_question_stats(question)
            for question in questions
        }
        for step in self._responses.answered_steps(
            survey["_id"], question_id=filter_question_id
        ):
            question_id = step.get("question_id")
            if question_id not in question_ids:
                continue
            stats = stats_by_id[question_id]
            value = step.get("value", {})
            stats["answered_count"] += 1
            if stats["type"] == "single_choice":
                self._increment_options(stats, [value.get("option_id")])
            elif stats["type"] == "multi_choice":
                self._increment_options(stats, value.get("option_ids", []))
            elif stats["type"] == "text":
                stats["answers"].append(
                    {
                        "text": value.get("text", ""),
                        "submitted_at": step.get("submitted_at"),
                    }
                )
            elif stats["type"] == "number":
                number = value.get("number")
                if isinstance(number, (int, float)) and not isinstance(number, bool):
                    stats["_sum"] += number

        results = []
        for question in questions:
            stats = stats_by_id[question["question_id"]]
            if stats["type"] == "number":
                stats["average"] = (
                    stats.pop("_sum") / stats["answered_count"]
                    if stats["answered_count"]
                    else None
                )
            results.append(stats)
        return results

    @staticmethod
    def _initial_question_stats(question: Dict[str, Any]) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "question_id": question["question_id"],
            "prompt": question["prompt"],
            "type": question["type"],
            "answered_count": 0,
        }
        if question["type"] in {"single_choice", "multi_choice"}:
            result["options"] = [
                {
                    "option_id": option["option_id"],
                    "label": option["label"],
                    "count": 0,
                }
                for option in question.get("options", [])
            ]
        elif question["type"] == "text":
            result["answers"] = []
        elif question["type"] == "number":
            result["_sum"] = 0
            result["average"] = None
        return result

    @staticmethod
    def _increment_options(stats: Dict[str, Any], selected_ids: List[Any]) -> None:
        counts = {option["option_id"]: option for option in stats["options"]}
        for option_id in selected_ids:
            option = counts.get(option_id)
            if option is not None:
                option["count"] += 1
