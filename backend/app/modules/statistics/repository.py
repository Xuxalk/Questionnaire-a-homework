from typing import Any, Dict, Iterable, Optional

from bson import ObjectId
from pymongo.collection import Collection


class StatisticsRepository:
    """Read-only aggregation queries over submitted responses."""

    def __init__(self, collection: Collection):
        self._collection = collection

    def count_submitted(self, survey_id: ObjectId) -> int:
        return self._collection.count_documents(
            {"survey_id": survey_id, "status": "submitted"}
        )

    def answered_steps(
        self,
        survey_id: ObjectId,
        *,
        question_id: Optional[str] = None,
    ) -> Iterable[Dict[str, Any]]:
        match: Dict[str, Any] = {
            "survey_id": survey_id,
            "status": "submitted",
        }
        pipeline = [
            {"$match": match},
            {"$unwind": "$steps"},
            {"$match": {"steps.status": "answered"}},
        ]
        if question_id is not None:
            pipeline.append({"$match": {"steps.question_id": question_id}})
        pipeline.append(
            {
                "$project": {
                    "_id": 0,
                    "question_id": "$steps.question_id",
                    "value": "$steps.value",
                    "submitted_at": 1,
                }
            }
        )
        return self._collection.aggregate(pipeline, allowDiskUse=True)
