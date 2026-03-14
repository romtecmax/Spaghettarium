from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(..., description="Natural language search query")
    max_results: int = Field(10, ge=1, le=50)
    min_confidence: float = Field(0.3, ge=0.0, le=1.0)


class ScriptResult(BaseModel):
    document_id: str
    version_id: str
    file_name: str | None
    file_path: str | None
    description: str | None
    tags: list[str] = []
    category: str | None
    confidence: float | None
    inputs: list[str] = []
    outputs: list[str] = []
    flow: str | None = None
    plugins: list[str] = []
    match_explanation: str = ""


class SearchResponse(BaseModel):
    query: str
    results: list[ScriptResult]
    total_found: int
    search_params: dict = {}


class ScriptDetail(BaseModel):
    document_id: str
    version_id: str
    file_name: str | None
    file_path: str | None
    description: str | None
    tags: list[str] = []
    category: str | None
    confidence: float | None
    inputs: list[str] = []
    outputs: list[str] = []
    flow: str | None = None
    plugins: list[dict] = []
    related_docs: list[str] = []
    component_count: int = 0
    wire_count: int = 0
    is_cluster: bool | None = None


class TagCount(BaseModel):
    tag: str
    count: int


class CategoryCount(BaseModel):
    category: str
    count: int
