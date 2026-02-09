from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from typing import Dict, List

def generate_tz_document(template_path: str, output_path: str, products: List[Dict]):
    """
    Generates a TZ document based on a template and a list of products.
    
    products structure:
    [
        {
            "name": "Logitech K120",
            "specs": {"Type": "Keyboard", "Color": "Black"}
        },
        ...
    ]
    """
    doc = Document(template_path)
    
    # Simple recursive replacement or appending
    # For this POC, we'll append tables at the end or replace a placeholder if found
    
    # Locate placeholder paragraph
    placeholder_p = None
    for p in doc.paragraphs:
        if "{{PRODUCT_TABLES_PLACEHOLDER}}" in p.text:
            placeholder_p = p
            p.text = "" # Clear placeholder text
            break
            
    # Function to add table after a paragraph (or at end)
    def add_product_section(document, product_data):
        # Add Product Header
        p = document.add_paragraph()
        # Handle both 'name' (legacy/test) and 'product_name' (api)
        p_name = product_data.get('product_name') or product_data.get('name') or "Unknown Product"
        run = p.add_run(f"Технические требования к товару: {p_name}")
        run.bold = True
        run.font.size = Pt(12)
        
        # Add Table
        table = document.add_table(rows=1, cols=2)
        table.style = 'Table Grid' # Standard grid style
        
        # Header Row
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = 'Наименование показателя'
        hdr_cells[1].text = 'Значениe показателя'
        
        # Style Header
        for cell in hdr_cells:
            for paragraph in cell.paragraphs:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = paragraph.runs[0]
                run.bold = True
        
        # Add Rows
        specs = product_data.get('specs', {})
        for key, value in specs.items():
            row_cells = table.add_row().cells
            row_cells[0].text = str(key)
            row_cells[1].text = str(value)
            
        document.add_paragraph('') # Spacer

    # Iterate products
    for product in products:
        add_product_section(doc, product)
        
    doc.save(output_path)
    print(f"Document saved to {output_path}")
    return output_path

if __name__ == "__main__":
    # Test Data
    mock_products = [
        {
            "name": "Клавиатура Logitech K120",
            "specs": {
                "Тип": "Клавиатура",
                "Интерфейс": "USB",
                "Цвет": "Черный",
                "Количество клавиш": "104"
            }
        },
        {
            "name": "Мышь Logitech B100",
            "specs": {
                "Тип": "Мышь",
                "Интерфейс": "USB",
                "Разрешение сенсора": "800 dpi"
            }
        }
    ]
    generate_tz_document('base_template.docx', 'test_tz.docx', mock_products)
