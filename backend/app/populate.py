"""A small equivalent of Mongoose's populate(): replaces ObjectId references in
(possibly nested) documents with the referenced documents."""
from bson import ObjectId


def projection(fields):
    """'username avatar' -> {'username': 1, 'avatar': 1}; '-password' -> {'password': 0}."""
    if not fields:
        return None
    if isinstance(fields, dict):
        return fields
    out = {}
    for name in fields.split():
        if name.startswith('-'):
            out[name[1:]] = 0
        else:
            out[name] = 1
    return out


def _walk(target, parts, visit):
    if target is None:
        return
    if isinstance(target, list):
        for item in target:
            _walk(item, parts, visit)
        return
    if not isinstance(target, dict):
        return
    if len(parts) == 1:
        visit(target, parts[0])
    else:
        _walk(target.get(parts[0]), parts[1:], visit)


async def populate(docs, path, collection, fields=None):
    """Populates `path` (e.g. 'author', 'members.user', 'replyTo.author') in place.
    Missing references become None (single) or are dropped (arrays), like Mongoose."""
    if docs is None:
        return docs
    parts = path.split('.')
    ids = set()

    def collect(holder, key):
        value = holder.get(key)
        if isinstance(value, ObjectId):
            ids.add(value)
        elif isinstance(value, list):
            ids.update(v for v in value if isinstance(v, ObjectId))

    _walk(docs, parts, collect)
    if not ids:
        return docs

    found = {}
    async for doc in collection.find({'_id': {'$in': list(ids)}}, projection(fields)):
        found[doc['_id']] = doc

    def replace(holder, key):
        value = holder.get(key)
        if isinstance(value, ObjectId):
            holder[key] = found.get(value)
        elif isinstance(value, list):
            holder[key] = [found[v] if isinstance(v, ObjectId) else v
                           for v in value if not isinstance(v, ObjectId) or v in found]

    _walk(docs, parts, replace)
    return docs
