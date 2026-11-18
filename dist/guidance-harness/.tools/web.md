---
description: How web_search is called. It says how to call it, not when. Delete this file and an agent that holds the tool is given no such guide.
---
web_search takes `query`, the words to look for, and `limit`, how many pages to give. Each page comes with its title, its address and the words around the match. Where no web search provider is set, the answer says search is off and nothing is searched.

    web_search {"query": "medieval harbour toll rates", "limit": 5}
