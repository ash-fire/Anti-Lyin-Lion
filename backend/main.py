from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from transformers import pipeline
from keybert import KeyBERT
from sentence_transformers import SentenceTransformer, util
import os
import requests
import torch
from dotenv import load_dotenv
from typing import Dict, List, Optional
from nltk.corpus import wordnet
import nltk

# Initialize NLTK data (run once)
try:
    nltk.data.find('corpora/wordnet')
except LookupError:
    nltk.download('wordnet')

load_dotenv()

app = FastAPI()
model = SentenceTransformer('paraphrase-MiniLM-L6-v2')

# Initialize analysis pipelines
emotion_classifier = pipeline(
    "text-classification",
    model="j-hartmann/emotion-english-distilroberta-base",
    return_all_scores=True
)

sentiment_analyzer = pipeline("sentiment-analysis")
kw_model = KeyBERT()
similarity_model = SentenceTransformer('all-MiniLM-L6-v2')

class AnalysisRequest(BaseModel):
    text: str
    find_sources: Optional[bool] = True


def get_wordnet_synonyms(word: str) -> List[str]:
    """Get WordNet synonyms for a word."""
    return list({lemma.name().replace('_', ' ') for syn in wordnet.synsets(word) for lemma in syn.lemmas()})

def get_bert_synonyms(keywords: List[str]) -> List[str]:
    """Safe BERT synonym expansion with proper tensor handling."""
    synonyms = set()
    
    for keyword in keywords:
        try:
            wordnet_syns = get_wordnet_synonyms(keyword)
            if not wordnet_syns:
                continue
            
            embeddings = model.encode([keyword] + wordnet_syns, convert_to_tensor=True)
            similarities = util.pytorch_cos_sim(embeddings[0].unsqueeze(0), embeddings[1:])
            
            valid_synonyms = [syn for syn, score in zip(wordnet_syns, similarities[0]) if score.item() > 0.6]
            synonyms.update(valid_synonyms)
        except Exception as e:
            print(f"Synonym error for '{keyword}': {str(e)}")
    
    return list(synonyms)

def formulate_search_query(keywords: List[str]) -> str:
    """Generate optimized search query focusing on keywords and relevant synonyms."""
    primary_terms = keywords[:3]
    expanded_synonyms = get_bert_synonyms(primary_terms)
    
    query_terms = list(dict.fromkeys(primary_terms + expanded_synonyms))
    return " ".join(query_terms)[:300]

def search_semantic_scholar(query: str) -> List[dict]:
    """Search Semantic Scholar for relevant academic articles."""
    url = "https://api.semanticscholar.org/graph/v1/paper/search"
    params = {
        "query": query,
        "fields": "title,authors,year,url,abstract",
        "limit": 10
    }
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        return response.json().get("data", [])
    except requests.RequestException as e:
        print(f"Semantic Scholar API error: {str(e)}")
        return []

def fetch_academic_articles(text: str, keywords: List[str]) -> List[dict]:
    """Formulates a search query and fetches academic articles."""
    query = formulate_search_query(keywords)
    return search_semantic_scholar(query)

@app.post("/analyze")
async def analyze_emotion(
    request: AnalysisRequest,
    x_api_key: str = Header(...)
):
    if x_api_key != os.getenv("API_KEY"):
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    text = request.text.strip()
    if not text or len(text) > 1000:
        raise HTTPException(status_code=400, detail="Invalid text input")

    try:
        emotion_results = emotion_classifier(text)[0]
        sorted_emotions = sorted(emotion_results, key=lambda x: x['score'], reverse=True)
        sentiment_result = sentiment_analyzer(text)[0]

        # Improved keyword extraction
        keywords = [kw[0] for kw in kw_model.extract_keywords(
            text, 
            keyphrase_ngram_range=(1, 2),
            stop_words='english',
            top_n=5
        )]

        # Academic source finding
        academic_sources = []
        if request.find_sources and keywords:
            academic_sources = fetch_academic_articles(text, keywords)

        return {
            "sentiment": {
                "label": sentiment_result['label'],
                "score": round(sentiment_result['score'], 3)
            },
            "primary_emotion": {
                "label": sorted_emotions[0]['label'],
                "score": round(sorted_emotions[0]['score'], 3),
                "intensity": get_emotional_intensity(sorted_emotions[0]['score'])
            },
            "secondary_emotions": [
                {"label": e['label'], "score": round(e['score'], 3)} 
                for e in sorted_emotions[1:]
            ],
            "emotional_complexity": {
                "is_mixed": len(sorted_emotions) > 1 and sorted_emotions[0]['score'] - sorted_emotions[1]['score'] < 0.2,
                "diversity_score": round(len([e for e in sorted_emotions if e['score'] > 0.1])/len(sorted_emotions), 3)
            },
            "keyword_insights": {
                "key_phrases": keywords,
                "emotional_triggers": [
                    phrase for phrase in keywords 
                    if any(emotion['label'] in phrase.lower() 
                    for emotion in sorted_emotions[:5])
                ]
            },
            "academic_sources": [
                {
                    "title": paper.get('title', 'Untitled'),
                    "authors": [a.get('name', '') for a in paper.get('authors', [])],
                    "year": paper.get('year', ''),
                    "url": paper.get('url', '#'),
                    "citationCount": paper.get('citationCount', 0),
                    "similarity": round(paper.get('similarity', 0), 2)
                } for paper in academic_sources
            ],
            "full_breakdown": {
                e['label']: round(e['score'], 3) 
                for e in sorted_emotions
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def get_emotional_intensity(score: float) -> str:
    if score >= 0.9: return "very high"
    if score >= 0.7: return "high"
    if score >= 0.5: return "moderate"
    return "low"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)