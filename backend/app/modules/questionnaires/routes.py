from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pymongo.database import Database

from backend.app.modules.accounts.security import get_current_user
from backend.app.modules.questionnaires.repository import SurveyRepository
from backend.app.modules.questionnaires.schemas import (
    DeadlineRequest,
    QuestionInput,
    SurveyCreateRequest,
    SurveyUpdateRequest,
)
from backend.app.modules.questionnaires.service import (
    QuestionnaireService,
    SurveyConflict,
    SurveyContentInvalid,
    SurveyNotFound,
)


router = APIRouter(prefix="/api/surveys", tags=["questionnaires"])


def get_questionnaire_service(request: Request) -> QuestionnaireService:
    database: Database = getattr(request.app.state, "database", None)
    if database is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MongoDB is not configured",
        )
    return QuestionnaireService(SurveyRepository(database["surveys"]))


def _invoke(operation):
    try:
        return operation()
    except SurveyNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Survey not found")
    except SurveyConflict as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except SurveyContentInvalid as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_survey(
    payload: SurveyCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return service.create_survey(
        current_user["_id"],
        title=payload.title,
        description=payload.description,
        anonymous=payload.anonymous,
        allow_multiple_submissions=payload.allow_multiple_submissions,
    )


@router.get("")
def list_surveys(
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return service.list_surveys(current_user["_id"])


@router.get("/{survey_id}")
def get_survey(
    survey_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(lambda: service.get_survey(survey_id, current_user["_id"]))


@router.patch("/{survey_id}")
def update_survey(
    survey_id: str,
    payload: SurveyUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    updates = payload.model_dump(exclude_unset=True)
    if "title" in updates and updates["title"] is None:
        raise HTTPException(status_code=422, detail="title cannot be null")
    return _invoke(
        lambda: service.update_survey(survey_id, current_user["_id"], updates)
    )


@router.put("/{survey_id}/deadline")
def set_deadline(
    survey_id: str,
    payload: DeadlineRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(
        lambda: service.set_deadline(
            survey_id, current_user["_id"], payload.deadline
        )
    )


@router.post("/{survey_id}/publish")
def publish_survey(
    survey_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(lambda: service.publish(survey_id, current_user["_id"]))


@router.post("/{survey_id}/close")
def close_survey(
    survey_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(lambda: service.close(survey_id, current_user["_id"]))


@router.post("/{survey_id}/questions", status_code=status.HTTP_201_CREATED)
def add_question(
    survey_id: str,
    payload: QuestionInput,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(
        lambda: service.add_question(survey_id, current_user["_id"], payload)
    )


@router.patch("/{survey_id}/questions/{question_id}")
def update_question(
    survey_id: str,
    question_id: str,
    payload: QuestionInput,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(
        lambda: service.update_question(
            survey_id, question_id, current_user["_id"], payload
        )
    )


@router.delete("/{survey_id}/questions/{question_id}")
def delete_question(
    survey_id: str,
    question_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
    service: QuestionnaireService = Depends(get_questionnaire_service),
):
    return _invoke(
        lambda: service.delete_question(survey_id, question_id, current_user["_id"])
    )
