# RAG Modules

This directory contains modular components for Retrieval-Augmented Generation (RAG) workflows in the I-GUIDE backend. These modules enable advanced search, retrieval, and generation capabilities by integrating large language models (LLMs), OpenSearch, and Neo4j graph database.

## Contents
- `generation_module.js`: Generates answers using relevant documents and LLMs.
- `grader_modules.js`: Tools for evaluating or grading generated responses.
- `llm_modules.js`: Utilities for interacting with LLM APIs and formatting prompts.
- `memory_modules.js`: Implements memory and context management for conversational agents.
- `neo4j_agent.js`: Handles graph-based retrieval and schema management using Neo4j.
- `rag_utils.js`: Utility functions for RAG pipelines, including rate limiting and document formatting.
- `routing_modules.js`: Manages routing logic for RAG pipelines.
- `search_modules.js`: Provides keyword and semantic search using OpenSearch and Neo4j.
- `spatial_search_modules.js`: Specialized modules for spatial and geospatial search.
- `spatial_utils.js`: Utilities for spatial data processing.
- `testLLMAgent.js`: Test scripts for LLM agent integration.
- `search_methods.csv`: Reference for available search methods.

## Usage
These modules are intended to be imported and used by the backend server and API routes. They provide composable building blocks for implementing RAG pipelines, including:
- Querying and retrieving relevant documents from OpenSearch and Neo4j
- Formatting and augmenting queries for LLMs
- Generating answers using LLMs with retrieved context
- Grading and evaluating LLM outputs
- Managing conversational memory and context

## Requirements
- Node.js
- Access to OpenSearch and Neo4j instances
- LLM API credentials (if using external LLMs)

## Author & License
See the main project `README.md` for author and license information.
