# potential-editor contracts

All endpoints require authentication, super_admin and potential-editor workspace.

| Method/path | Request | Response |
| --- | --- | --- |
| GET /api/v1/potential-pool | none | {options: [{statType, statName, value, showValue, grade, pool}]} |
| POST /api/v1/potentials/list | {session_id} | {session, equipment, result} |
| POST /api/v1/potentials/set | {session_id, instance_id, potentials: [{stat_type, value}]} | {session, result} |

Pool options come from enabled CSV entries. Values are decimal strings and
instance IDs contain digits only. Set accepts one to three ordered entries,
validates all entries, then sends the complete potentialset@instance@type:value
command through privateChat. Adding the first potential uses the same operation.
Empty reset syntax is not assumed and is rejected.

List sends potential@list and parses System text. Equipment contains instanceId,
templateId, optional name/image and potentials [{slot, statType, statName, value,
grade}]. Empty equipment remains in the list, template leading zeros are retained.
Missing/unrecognized responses yield potential-list-unconfirmed (502) rather
than a successful empty inventory.

Downstream delivery_status is preserved. An unknown result is displayed as
unconfirmed and requires list verification; mutation requests are never retried
automatically. Errors include unauthorized (401), forbidden (403), invalid-input
(400). Session lifecycle also follows the existing auto permission/connection gate.
