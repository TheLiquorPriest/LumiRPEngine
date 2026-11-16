---
description: The layout of the Author's own record of a turn, as the file in the turn's folder that the records mode carries to later turns of the session (the carried part's header names the file). Its fields are the record's own, namely its reply's number, what the Author read as the intent, what it decided and why, its rulings and consents, what it meant to do next, when it was last touched, and, where they are set, that it was closed or dropped and the replies it covers. It lays the record out; it asks for nothing. Switched off, no record file is written and the records mode carries nothing.
---
Record of the turn at reply {{message}}
{{#intent}}

Intent: {{intent}}
{{/intent}}
{{#decided}}

Decided: {{decided}}
{{/decided}}
{{#why}}

Why: {{why}}
{{/why}}
{{#rulings}}

Rulings: {{rulings}}
{{/rulings}}
{{#consents}}

Consents: {{consents}}
{{/consents}}
{{#next}}

Next: {{next}}
{{/next}}
{{#touched}}

Last touched at reply {{touched}}.
{{/touched}}
{{#from}}

Covers replies {{from}} to {{to}}.
{{/from}}
{{#closed}}

Closed.
{{/closed}}
{{#dropped}}

Dropped.
{{/dropped}}
