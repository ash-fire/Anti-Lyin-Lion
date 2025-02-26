const API_ENDPOINT = 'http://localhost:8000/analyze';

const elements = {
    loader: document.getElementById('loader'),
    result: document.getElementById('result'),
    error: document.getElementById('error'),
    errorMessage: document.querySelector('.error-message')
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (!elements.loader || !elements.result || !elements.error) {
            throw new Error('UI components missing');
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const text = await getSelectedText(tab.id);
        
        if (!text) {
            showError('❌ No text selected - Please highlight text first');
            return;
        }

        toggleLoader(true);
        const analysis = await analyzeText(text);
        showResult(analysis);

    } catch (error) {
        showError(error.message.includes('Failed to get text') ? 
            '⚠️ Text selection failed - Try copying text first (Ctrl/Cmd+C)' : 
            error.message
        );
    }
});

async function getSelectedText(tabId) {
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                if (window.location.hostname === 'docs.google.com') {
                    try {
                        return document.querySelector('.kix-rotatingtilemanager')?.innerText?.trim() || '';
                    } catch(e) {
                        document.execCommand('copy');
                        return navigator.clipboard.readText();
                    }
                }
                return window.getSelection().toString().trim();
            }
        });
        return result?.result || '';
    } catch (error) {
        throw new Error('❌ Failed to get text from this document type');
    }
}

async function analyzeText(text) {
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': await getApiKey()
            },
            body: JSON.stringify({ 
                text,
                find_sources: true
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || `⚠️ Server error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`❌ Analysis failed: ${error.message}`);
    }
}

async function getApiKey() {
    return 'my-super-secret-key-1234';
}

function toggleLoader(show) {
    elements.loader.classList.toggle('hidden', !show);
    elements.result.classList.toggle('hidden', show);
    elements.error.classList.add('hidden');
}

function showResult(data) {
    try {
        toggleLoader(false);
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response from server');
        }
        elements.result.innerHTML = buildResultTemplate(data);
    } catch (error) {
        showError(`❌ Display error: ${error.message}`);
    }
}

function buildResultTemplate(data) {
    const emotionEmojis = {
        joy: '😃', anger: '😡', sadness: '😢', fear: '😨', surprise: '😲', disgust: '🤢', neutral: '😐'
    };

    return `
        <div class="emotion-section">
            <h3>Primary Emotion</h3>
            <div class="emotion-chip primary ${data.primary_emotion?.label.toLowerCase()}">
                ${emotionEmojis[data.primary_emotion?.label.toLowerCase()] || '🎭'} 
                ${data.primary_emotion?.label || 'Unknown'} 
                <span class="confidence">
                    ${(data.primary_emotion?.score ?? 0).toFixed(3)} 
                    (${data.primary_emotion?.intensity || 'N/A'})
                </span>
            </div>
        </div>

        ${data.secondary_emotions?.length ? `
        <div class="emotion-section">
            <h4>Secondary Emotions</h4>
            <div class="secondary-emotions">
                ${(data.secondary_emotions || []).map(e => `
                    <span class="emotion-chip secondary ${e.label.toLowerCase()}">
                        ${emotionEmojis[e.label.toLowerCase()] || '🎭'} ${e.label} 
                        <span class="confidence">${(e.score ?? 0).toFixed(3)}</span>
                    </span>
                `).join('')}
            </div>
        </div>` : ''}

        <div class="sentiment-section">
            <h4>Overall Sentiment</h4>
            <div class="sentiment ${data.sentiment?.label?.toLowerCase() || 'neutral'}">
                ${emotionEmojis[data.sentiment?.label.toLowerCase()] || '🔍'} ${data.sentiment?.label || 'Neutral'} 
                (${(data.sentiment?.score ?? 0).toFixed(3)})
            </div>
        </div>

        <div class="complexity-section">
            <h4>Emotional Complexity</h4>
            <div class="complexity-badge ${data.emotional_complexity?.is_mixed ? 'mixed' : 'clear'}">
                ${data.emotional_complexity?.is_mixed ? '🎭 Mixed Emotions' : '🎯 Clear Emotion'}
                <span class="diversity">
                    Diversity: ${(data.emotional_complexity?.diversity_score ?? 0).toFixed(3)}
                </span>
            </div>
        </div>

        <div class="keywords-section">
            <h4>Key Phrases</h4>
            <div class="phrases">
                ${(data.keyword_insights?.key_phrases || []).map(phrase => `
                    <span class="phrase">📝 ${phrase}</span>
                `).join('')}
            </div>
            
            ${data.keyword_insights?.emotional_triggers?.length ? `
            <h4>Emotional Triggers</h4>
            <div class="triggers">
                ${data.keyword_insights.emotional_triggers.map(trigger => `
                    <span class="trigger">⚠️ ${trigger}</span>
                `).join('')}
            </div>` : ''}
        </div>

        ${data.academic_sources?.length ? `
        <div class="sources-section">
            <h4>Relevant Academic Sources</h4>
            <div class="source-list">
                ${data.academic_sources.map(paper => `
                    <div class="source-item">
                        <div class="source-meta">
                            ${paper.citationCount ? `<span class="citation-count">📈 ${paper.citationCount} citations</span>` : ''}
                        </div>
                        <a href="${paper.url}" target="_blank" class="source-link">
                            📚 ${paper.title} ${paper.year ? `(${paper.year})` : ''}
                        </a>
                        ${paper.authors?.length ? `<div class="source-authors">👨‍🏫 ${paper.authors.join(', ')}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    
        <div class="breakdown-section">
            <details>
                <summary>📊 Full Emotional Breakdown</summary>
                <div class="breakdown-grid">
                    ${Object.entries(data.full_breakdown || {}).map(([emotion, score]) => `
                        <div class="breakdown-item">
                            <span class="emotion-label">${emotionEmojis[emotion.toLowerCase()] || '🎭'} ${emotion}</span>
                            <span class="emotion-score">${Number(score).toFixed(3)}</span>
                        </div>
                    `).join('')}
                </div>
            </details>
        </div>
    `;
}

function showError(message) {
    toggleLoader(false);
    elements.error.classList.remove('hidden');
    const errorText = message.includes('429') ? 
        '⚠️ Too many requests - Please wait a minute' :
        message;
        
    if (elements.errorMessage) {
        elements.errorMessage.innerHTML = errorText;
    } else {
        elements.error.textContent = errorText;
    }
}
