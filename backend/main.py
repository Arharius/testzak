from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional, Dict, List, Any
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
import logging
import json
import os

from scraper_poc import scrape_dns
from doc_generator import generate_tz_document
from database import engine, get_db, Base
from models import User, TZDocument
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, get_optional_user
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI()
os.makedirs("temp", exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Models ──

class ProductRequest(BaseModel):
    product_name: str

class ProductResponse(BaseModel):
    product_name: str
    specs: Any = {}
    source: str = "dns-shop"

class DocumentMetadata(BaseModel):
    product_title: str = "оборудование"
    zakazchik: str = ""
    quantity: int = 1
    quantity_text: str = ""

class GenerateRequest(BaseModel):
    metadata: DocumentMetadata = DocumentMetadata()
    products: List[ProductResponse] = []

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    token: str
    user: dict

class SaveDocumentRequest(BaseModel):
    title: str
    metadata: DocumentMetadata = DocumentMetadata()
    products: List[ProductResponse] = []

class DocumentOut(BaseModel):
    id: int
    title: str
    metadata: dict
    products: list
    created_at: str
    updated_at: str


# ── Core Endpoints ──

@app.get("/")
def read_root():
    return {"message": "ТЗ Generator API is running"}


@app.post("/api/scrape", response_model=ProductResponse)
async def scrape_product(request: ProductRequest):
    logger.info(f"Scrape request: {request.product_name}")
    try:
        specs = await scrape_dns(request.product_name)
        if not specs:
            return ProductResponse(
                product_name=request.product_name,
                specs=[{"group": "Ошибка", "specs": [{"name": "Статус", "value": "Данные не найдены"}]}]
            )
        return ProductResponse(product_name=request.product_name, specs=specs)
    except Exception as e:
        logger.error(f"Scrape error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate")
async def generate_document(request: GenerateRequest):
    logger.info(f"Generating doc for {len(request.products)} products")
    try:
        products_data = [p.dict() for p in request.products]
        metadata = request.metadata.dict()
        template_path = "base_template.docx"
        output_path = os.path.join("temp", "generated_tz.docx")

        if not os.path.exists(template_path):
            from create_template import create_base_template
            create_base_template()

        generate_tz_document(template_path, output_path, products_data, metadata)
        return FileResponse(
            path=output_path,
            filename="generated_tz.docx",
            media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
    except Exception as e:
        logger.error(f"Generate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Auth Endpoints ──

@app.post("/api/auth/register", response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    user = User(
        email=req.email,
        name=req.name,
        hashed_password=hash_password(req.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "name": user.name}
    )


@app.post("/api/auth/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "name": user.name}
    )


@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "name": user.name}


# ── Document CRUD ──

@app.post("/api/documents", response_model=DocumentOut)
def save_document(req: SaveDocumentRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = TZDocument(
        user_id=user.id,
        title=req.title,
        metadata_json=json.dumps(req.metadata.dict(), ensure_ascii=False),
        products_json=json.dumps([p.dict() for p in req.products], ensure_ascii=False),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _doc_to_out(doc)


@app.get("/api/documents", response_model=List[DocumentOut])
def list_documents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = db.query(TZDocument).filter(TZDocument.user_id == user.id).order_by(TZDocument.updated_at.desc()).all()
    return [_doc_to_out(d) for d in docs]


@app.get("/api/documents/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(TZDocument).filter(TZDocument.id == doc_id, TZDocument.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return _doc_to_out(doc)


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(TZDocument).filter(TZDocument.id == doc_id, TZDocument.user_id == user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    db.delete(doc)
    db.commit()
    return {"ok": True}


def _doc_to_out(doc: TZDocument) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        title=doc.title,
        metadata=json.loads(doc.metadata_json),
        products=json.loads(doc.products_json),
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
    )
