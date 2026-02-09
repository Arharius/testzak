from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
from fastapi.middleware.cors import CORSMiddleware
import logging

# Import the scraper function (we might need to adjust import if in same dir)
from scraper_poc import scrape_dns

from fastapi.responses import FileResponse
from doc_generator import generate_tz_document
import os
from typing import List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Ensure temp directory exists
os.makedirs("temp", exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProductRequest(BaseModel):
    product_name: str

class ProductResponse(BaseModel):
    product_name: str
    specs: Dict[str, str] = {}
    source: str = "dns-shop"

@app.get("/")
def read_root():
    return {"message": "ТЗ Generator API is running"}

@app.post("/api/scrape", response_model=ProductResponse)
async def scrape_product(request: ProductRequest):
    logger.info(f"Received scrape request for: {request.product_name}")
    try:
        specs = await scrape_dns(request.product_name)
        
        if not specs:
            # Mock data for now if scraping fails, to allow frontend dev
            logger.warning("Scraping failed, returning mock data")
            return ProductResponse(
                product_name=request.product_name,
                specs={
                    "Название": request.product_name,
                    "Статус": "Данные не найдены (Mock)",
                    "Инструкция": "Нажмите 'Редактировать', чтобы добавить характеристики вручную"
                }
            )
            
        return ProductResponse(
            product_name=request.product_name,
            specs=specs
        )
    except Exception as e:
        logger.error(f"Error in scrape endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate")
async def generate_document(products: List[ProductResponse]):
    logger.info(f"Generating document for {len(products)} products")
    try:
        # Convert Pydantic models to dicts
        products_data = [p.dict() for p in products]
        
        # Define paths
        template_path = "base_template.docx"
        output_filename = "generated_tz.docx"
        output_path = os.path.join("temp", output_filename)
        
        # Ensure template exists (create if not found - helpful for dev)
        if not os.path.exists(template_path):
            from create_template import create_base_template
            create_base_template()
            
        # Generate
        generate_tz_document(template_path, output_path, products_data)
        
        return FileResponse(
            path=output_path, 
            filename=output_filename, 
            media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
    except Exception as e:
        logger.error(f"Error generating document: {e}")
        raise HTTPException(status_code=500, detail=str(e))
