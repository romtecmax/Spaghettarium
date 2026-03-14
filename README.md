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
