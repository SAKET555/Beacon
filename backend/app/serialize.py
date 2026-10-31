"""Converts Mongo documents into the same JSON shape Express/Mongoose produced."""
from datetime import datetime

from bson import ObjectId


def iso(value: datetime) -> str:
    return value.strftime('%Y-%m-%dT%H:%M:%S.') + f'{value.microsecond // 1000:03d}Z'


def to_json(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, dict):
        return {key: to_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json(item) for item in value]
    return value
