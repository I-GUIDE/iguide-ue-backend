import sys
import boto3
import ast
import json
import nbformat
import tempfile
import logging
import os
import re
from botocore.exceptions import NoCredentialsError, PartialCredentialsError
from typing import Dict, List

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

def sanitize_tag_value(value: str) -> str:
    """Sanitize metadata values for Minio tags."""
    allowed_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-=._:/ "
    sanitized = "".join([c if c in allowed_chars else "_" for c in str(value)])
    return sanitized[:128]

def extract_python_metadata(code: str) -> List[Dict]:
    """Extract functions and classes from Python code using AST."""
    metadata = []
    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_metadata = {
                    "type": "function",
                    "name": node.name,
                    "params": [arg.arg for arg in node.args.args],
                    "docstring": ast.get_docstring(node) or ""
                }
                metadata.append(func_metadata)
            elif isinstance(node, ast.ClassDef):
                class_metadata = {
                    "type": "class",
                    "name": node.name,
                    "methods": [],
                    "docstring": ast.get_docstring(node) or ""
                }
                metadata.append(class_metadata)
    except Exception as e:
        logging.warning(f"Python parsing error: {e}")
    return metadata

def extract_java_metadata(code: str) -> List[Dict]:
    """Extract methods and classes from Java code using regex."""
    metadata = []
    try:
        # Simple regex-based parser for demonstration
        class_pattern = r'class\s+(\w+)\s*{([^}]*)}'
        method_pattern = r'(public|private|protected|static|\s) +[\w\<\>\[\]]+\s+(\w+)\s*\(([^)]*)\)'
        
        for class_match in re.finditer(class_pattern, code, re.DOTALL):
            class_name = class_match.group(1)
            class_metadata = {
                "type": "class",
                "name": class_name,
                "methods": []
            }
            class_body = class_match.group(2)
            
            for method_match in re.finditer(method_pattern, class_body):
                return_type = method_match.group(0).split()[1]
                method_name = method_match.group(2)
                params = method_match.group(3).split(',') if method_match.group(3) else []
                
                method_metadata = {
                    "name": method_name,
                    "return_type": return_type,
                    "params": params
                }
                class_metadata["methods"].append(method_metadata)
            
            metadata.append(class_metadata)
    except Exception as e:
        logging.warning(f"Java parsing error: {e}")
    return metadata

def extract_notebook_metadata(notebook_path: str) -> List[Dict]:
    """Extract code cells and functions from Jupyter notebooks."""
    metadata = []
    try:
        with open(notebook_path) as f:
            nb = nbformat.read(f, as_version=4)
        
        for cell in nb.cells:
            if cell.cell_type == "code":
                cell_metadata = {
                    "type": "code_cell",
                    "source": cell.source.split('\n'),
                    "functions": extract_python_metadata(cell.source)
                }
                metadata.append(cell_metadata)
    except Exception as e:
        logging.warning(f"Notebook parsing error: {e}")
    return metadata

def process_file(file_path: str, bucket: str) -> Dict:
    """Process files based on bucket and file type."""
    metadata = {}
    try:
        if bucket == "code":
            with open(file_path, 'r') as f:
                content = f.read()
                
            if file_path.endswith('.py'):
                metadata["code_analysis"] = extract_python_metadata(content)
            elif file_path.endswith('.java'):
                metadata["code_analysis"] = extract_java_metadata(content)
                
        elif bucket == "notebooks" and file_path.endswith('.ipynb'):
            metadata["notebook_analysis"] = extract_notebook_metadata(file_path)
            
    except Exception as e:
        logging.error(f"Processing failed for {file_path}: {e}")
    
    return metadata

def extract_metadata(bucket: str, key: str):
    try:
        # Initialize S3 client for Minio
        s3 = boto3.client(
            's3',
            endpoint_url="http://i-guide-storage-dev.cis220065.projects.jetstream-cloud.org:9010",
            aws_access_key_id="access_id",
            aws_secret_access_key="access_key",
            config=boto3.session.Config(signature_version='s3v4')
        )

        # Download file to temporary storage
        tmp_path = f"/tmp/{key}"
        logging.info(f"Downloading {key} from bucket {bucket}")
        s3.download_file(bucket, key, tmp_path)
        logging.info(f"Download complete: {tmp_path}")

        # Process based on bucket type
        metadata = process_file(tmp_path, bucket)
        
        if not metadata:
            logging.warning("No metadata extracted")
            return

        logging.info(f"Extracted metadata: {json.dumps(metadata, indent=2)}")

        # Sanitize and format for tagging
        sanitized_metadata = {}
        if "code_analysis" in metadata:
            for i, item in enumerate(metadata["code_analysis"]):
                prefix = f"code_{i}_"
                sanitized_metadata[prefix+"type"] = sanitize_tag_value(item["type"])
                sanitized_metadata[prefix+"name"] = sanitize_tag_value(item["name"])
                
        if "notebook_analysis" in metadata:
            for i, cell in enumerate(metadata["notebook_analysis"]):
                prefix = f"nb_cell_{i}_"
                sanitized_metadata[prefix+"type"] = "code_cell"
                sanitized_metadata[prefix+"func_count"] = str(len(cell["functions"]))

        # Attach metadata to Minio object
        s3.put_object_tagging(
            Bucket=bucket,
            Key=key,
            Tagging={'TagSet': [{'Key': k, 'Value': v} for k, v in sanitized_metadata.items()]}
        )
        logging.info("Metadata attached successfully")

    except NoCredentialsError:
        logging.error("Missing Minio credentials.")
    except Exception as e:
        logging.error(f"Error: {e}")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        logging.error("Usage: python extract_metadata.py <bucket> <key>")
        sys.exit(1)
    bucket, key = sys.argv[1], sys.argv[2]
    extract_metadata(bucket, key)