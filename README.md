# Spaghettarium
Explore the invisible structures behind your grasshopper scripts.

## Setup 

### 1 Neo4j database
You need to start a local instance of a neo4j database with the grasshopper db loaded
When creating the database remember the username and password, you'll need it later!


### 2 Environment Variables

Define the following env vars:
```
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=<db username>
NEO4J_PASSWORD=<db password>
NEO4J_DATABASE=<db name>
```

### 3 Import data

Please refer to the shared drive [here](https://drive.google.com/drive/u/0/folders/1Sy661tPfSBV0fCecJTTcO-irZ_qfm18Q) and the accompanying [documentation](https://docs.google.com/document/d/10-vrsfhnBPGUT3_xMq7CGvkRkE3mPBLjhlMUNmhimmw/edit?tab=t.0). 

## Further Reading

### Backend (`backend/`)
- [backend/README.md](backend/README.md) — Backend project structure, data pipeline, and how to run the FastAPI server.
- [backend/API_INTEGRATION.md](backend/API_INTEGRATION.md) — REST API endpoint reference for search, import, and script launch.
- [backend/SPAGHETTARIUM_INTEGRATION.md](backend/SPAGHETTARIUM_INTEGRATION.md) — Guide for wiring AI-enriched graph data into the frontend.
- [backend/CLAUDE.md](backend/CLAUDE.md) — Developer notes and commands for working with the backend.
