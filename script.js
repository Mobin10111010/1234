class Config {
  constructor() {
    this.botToken = localStorage.getItem('botToken') || '';
    this.channelId = localStorage.getItem('channelId') || '';
    this.rssFeeds = JSON.parse(localStorage.getItem('rssFeeds') || '[]');
  }

  save() {
    localStorage.setItem('botToken', this.botToken);
    localStorage.setItem('channelId', this.channelId);
    localStorage.setItem('rssFeeds', JSON.stringify(this.rssFeeds));
  }

  addRssFeed(url, language) {
    if (!this.rssFeeds.find(feed => feed.url === url)) {
      this.rssFeeds.push({ url, language });
      this.save();
      return true;
    }
    return false;
  }

  removeRssFeed(url) {
    this.rssFeeds = this.rssFeeds.filter(feed => feed.url !== url);
    this.save();
  }

  isConfigured() {
    return this.botToken && this.channelId;
  }
}

const config = new Config();



class RssReader {
  constructor() {
    this.parser = new DOMParser();
  }

  async fetchFeed(url) {
    try {
      const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      const xmlDoc = this.parser.parseFromString(data.contents, 'text/xml');
      return this.parseRssFeed(xmlDoc);
    } catch (error) {
      console.error('Error fetching RSS feed:', error);
      throw error;
    }
  }

  parseRssFeed(xmlDoc) {
    const items = xmlDoc.querySelectorAll('item');
    return Array.from(items).map(item => ({
      title: item.querySelector('title')?.textContent || '',
      description: item.querySelector('description')?.textContent || '',
      link: item.querySelector('link')?.textContent || '',
      pubDate: item.querySelector('pubDate')?.textContent || '',
      imageUrl: this.extractImageUrl(item)
    }));
  }

  extractImageUrl(item) {
    const mediaContent = item.querySelector('media\\:content, content');
    const enclosure = item.querySelector('enclosure');
    const description = item.querySelector('description')?.textContent || '';
    
    if (mediaContent && mediaContent.getAttribute('url')) {
      return mediaContent.getAttribute('url');
    } else if (enclosure && enclosure.getAttribute('type')?.startsWith('image/')) {
      return enclosure.getAttribute('url');
    } else {
      const imgMatch = description.match(/<img[^>]+src="([^">]+)"/);
      return imgMatch ? imgMatch[1] : null;
    }
  }
}

const rssReader = new RssReader();





class TelegramBot {
  constructor(token) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(channelId, text, parseMode = 'HTML') {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: channelId,
          text: text,
          parse_mode: parseMode
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async sendPhoto(channelId, photoUrl, caption, parseMode = 'HTML') {
    try {
      const response = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: channelId,
          photo: photoUrl,
          caption: caption,
          parse_mode: parseMode
        })
      });
      return await response.json();
    } catch (error) {
      console.error('Error sending photo:', error);
      throw error;
    }
  }
}


















let bot = null;
let botInterval = null;
let lastProcessedItems = new Map();
let startTime = null;
let postCount = 0;

// Add supported languages
const supportedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'fa', name: 'Persian', rtl: true },
  { code: 'ar', name: 'Arabic', rtl: true },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'tr', name: 'Turkish' },
  { code: 'nl', name: 'Dutch' }
];

function log(message) {
  const statusLog = document.getElementById('statusLog');
  const logEntry = document.createElement('div');
  logEntry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  statusLog.appendChild(logEntry);
  statusLog.scrollTop = statusLog.scrollHeight;
}

function saveConfig() {
  const botToken = document.getElementById('botToken').value;
  const channelId = document.getElementById('channelId').value;
  
  config.botToken = botToken;
  config.channelId = channelId;
  config.save();
  
  log(' Configuration saved successfully');
}

function updateLanguageDirection(language) {
  const lang = supportedLanguages.find(l => l.code === language);
  document.documentElement.setAttribute('dir', lang?.rtl ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', language);
  
  // Add appropriate language class to body
  document.body.classList.remove('lang-fa', 'lang-ar');
  if (language === 'fa' || language === 'ar') {
    document.body.classList.add(`lang-${language}`);
  }
}

async function addRssFeed() {
  const url = document.getElementById('rssUrl').value;
  const language = document.getElementById('feedLanguage').value;
  
  if (url) {
    const urlAnalysis = await validateAndAnalyzeRssUrl(url);
    
    if (urlAnalysis && urlAnalysis.isValid) {
      if (config.addRssFeed(url, language)) {
        updateRssList();
        document.getElementById('rssUrl').value = '';
        log(` Added RSS feed: ${url} (${language})`);
        updateLanguageDirection(language);
        
        // Show feed analysis
        showFeedAnalysisModal(urlAnalysis);
      } else {
        log(' RSS feed already exists');
      }
    } else {
      showAlert('Invalid RSS feed URL or feed not accessible', 'error');
    }
  }
}

async function translateContent(text, targetLanguage) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Translate the following text to ${targetLanguage}. 
        Consider cultural context and maintain appropriate formatting.
        For Persian and Arabic, ensure proper RTL formatting and cultural sensitivity.
        
        Text to translate:
        ${text}
        
        Return format:
        {
          "translatedText": "...",
          "confidence": 0.95,
          "culturalNotes": ["..."],
          "preservedElements": ["links", "formatting"]
        }`,
      })
    });

    const result = await response.json();
    return result.translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    return text;
  }
}

function updateRssList() {
  const rssList = document.getElementById('rssList');
  rssList.innerHTML = '';
  
  config.rssFeeds.forEach(feed => {
    const item = document.createElement('div');
    item.className = 'rss-item';
    item.innerHTML = `
      <div class="rss-item-content">
        <span class="rss-url">${feed.url}</span>
        <span class="language-tag">${feed.language}</span>
        <div class="rss-item-controls">
          <button class="delete-btn" onclick="removeRssFeed('${feed.url}')">
            <i class="mdi mdi-delete"></i> Delete
          </button>
        </div>
      </div>
    `;
    rssList.appendChild(item);
  });
}

function removeRssFeed(url) {
  if (confirm('Are you sure you want to delete this feed?')) {
    config.removeRssFeed(url);
    updateRssList();
    log(` Removed RSS feed: ${url}`);
    updateStats();
    
    // Show success message
    showAlert('Feed removed successfully', 'success');
  }
}

async function isContentDuplicate(newContent) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze this content and generate a unique content fingerprint that captures the key meaning, regardless of exact wording or language.
        Return a JSON object with a similarity score.
        
        interface Response {
          contentFingerprint: string;
          topicCategory: string;
        }
        
        {
          "contentFingerprint": "ukraine-russia-peace-talks-fail",
          "topicCategory": "international-conflict"
        }`,
        data: newContent
      })
    });

    const fingerprint = await response.json();
    
    const recentFingerprints = JSON.parse(localStorage.getItem('recentFingerprints') || '[]');
    const isDuplicate = recentFingerprints.some(item => 
      item.fingerprint === fingerprint.contentFingerprint ||
      item.category === fingerprint.topicCategory
    );

    recentFingerprints.unshift({
      fingerprint: fingerprint.contentFingerprint,
      category: fingerprint.topicCategory,
      timestamp: Date.now()
    });

    if (recentFingerprints.length > 100) {
      recentFingerprints.pop();
    }

    localStorage.setItem('recentFingerprints', JSON.stringify(recentFingerprints));
    return isDuplicate;
  } catch (error) {
    console.error('Error checking for duplicates:', error);
    return false;
  }
}

async function analyzeSentiment(content) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze the sentiment and key themes of this content.
        Return a JSON object with the analysis results.
        
        interface Response {
          sentiment: 'positive' | 'negative' | 'neutral';
          score: number;
          mainThemes: string[];
          emotionalTone: string;
          contentQuality: number;
        }
        
        Example:
        {
          "sentiment": "positive",
          "score": 0.8,
          "mainThemes": ["technology", "innovation", "progress"],
          "emotionalTone": "optimistic",
          "contentQuality": 0.9
        }`,
        data: content
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    return null;
  }
}

async function generateSummary(content) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Generate a concise summary of this content.
        Return a JSON object with the summary and key points.
        
        interface Response {
          summary: string;
          keyPoints: string[];
          readingTime: number;
          complexityLevel: 'basic' | 'intermediate' | 'advanced';
        }
        
        Example:
        {
          "summary": "A breakthrough in quantum computing...",
          "keyPoints": ["New quantum chip developed", "Faster processing speeds"],
          "readingTime": 3,
          "complexityLevel": "intermediate"
        }`,
        data: content
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error generating summary:', error);
    return null;
  }
}

async function enhanceContent(content) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Enhance this content to make it more engaging and informative.
        Return a JSON object with the enhanced content.
        
        interface Response {
          enhancedContent: string;
          addedContext: string[];
          suggestions: string[];
          readabilityScore: number;
        }
        
        Example:
        {
          "enhancedContent": "In a groundbreaking development...",
          "addedContext": ["Historical background", "Future implications"],
          "suggestions": ["Add expert quotes", "Include statistics"],
          "readabilityScore": 0.85
        }`,
        data: content
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error enhancing content:', error);
    return null;
  }
}

async function formatTelegramMessage(content, sourceUrl, language) {
  const sentiment = await analyzeSentiment(content);
  const summary = await generateSummary(content);
  const enhanced = await enhanceContent(content);
  const appropriateness = await analyzeContentAppropriateness(content);
  
  let formattedMessage = '';
  
  // Add content warning if needed
  if (appropriateness && appropriateness.contentRating === 'PG-13') {
    formattedMessage += '⚠️ Content Warning: This post may contain mature themes\n\n';
  }
  
  formattedMessage += `📰 <b>${summary.summary}</b>\n\n`;
  formattedMessage += `${enhanced.enhancedContent}\n\n`;
  
  if (sentiment.mainThemes.length > 0) {
    formattedMessage += `🔑 Key Themes: ${sentiment.mainThemes.join(', ')}\n`;
  }
  
  formattedMessage += `\n📊 Content Quality: ${sentiment.contentQuality * 100}%\n`;
  formattedMessage += `⏱ Reading Time: ${summary.readingTime} minutes\n\n`;
  
  const hashtags = sentiment.mainThemes.map(theme => `#${theme.replace(/\s+/g, '')}`);
  formattedMessage += hashtags.join(' ');
  
  // Translate if needed
  if (language && language !== 'en') {
    formattedMessage = await translateContent(formattedMessage, language);
  }
  
  return formattedMessage;
}

async function analyzeContentAppropriateness(content) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze this content for appropriateness and safety.
        Check for adult content, explicit material, inappropriate themes, or sensitive topics.
        Return a detailed analysis with confidence scores.
        
        interface Response {
          isAppropriate: boolean;
          confidenceScore: number;
          flags: string[];
          contentRating: 'G' | 'PG' | 'PG-13' | 'R' | '18+';
          reasons: string[];
        }
        
        Example:
        {
          "isAppropriate": true,
          "confidenceScore": 0.95,
          "flags": [],
          "contentRating": "G",
          "reasons": ["Family-friendly content", "No inappropriate themes"]
        }`,
        data: content
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error analyzing content appropriateness:', error);
    return null;
  }
}

function updateStats() {
  document.getElementById('activeFeeds').textContent = config.rssFeeds.length;
  document.getElementById('postsToday').textContent = postCount;
  
  if (startTime) {
    const uptime = Math.floor((Date.now() - startTime) / (1000 * 60 * 60));
    document.getElementById('uptime').textContent = `${uptime}h`;
  }
}

function clearLog() {
  document.getElementById('statusLog').innerHTML = '';
  log('Log cleared');
}

function exportLog() {
  const logContent = document.getElementById('statusLog').innerText;
  const blob = new Blob([logContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bot-log-${new Date().toISOString()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function testConnection() {
  const testBtn = document.getElementById('testBtn');
  testBtn.disabled = true;
  testBtn.innerHTML = '<span class="loading-animation"></span> Testing...';
  
  try {
    if (!config.isConfigured()) {
      throw new Error('Bot not configured');
    }
    
    const testBot = new TelegramBot(config.botToken);
    await testBot.sendMessage(config.channelId, '🔄 Bot connection test successful!');
    
    showAlert('Connection test successful!', 'success');
  } catch (error) {
    showAlert('Connection test failed: ' + error.message, 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = '<i class="mdi mdi-test-tube"></i> Test Connection';
  }
}

function showAlert(message, type = 'success') {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type}`;
  alertDiv.innerHTML = `
    <i class="mdi mdi-${type === 'success' ? 'check-circle' : 'alert'}"></i>
    ${message}
  `;
  
  document.querySelector('.container').insertBefore(alertDiv, document.querySelector('.config-section'));
  
  setTimeout(() => alertDiv.remove(), 5000);
}

function updateBotStatus(isActive) {
  const statusIndicator = document.getElementById('botStatus');
  const statusText = document.getElementById('botStatusText');
  
  statusIndicator.className = `status-indicator status-${isActive ? 'active' : 'inactive'}`;
  statusText.textContent = isActive ? 'Active' : 'Inactive';
}

function updateInsightPanel(insights) {
  const insightsElement = document.getElementById('insights');
  insightsElement.innerHTML = `
    <div class="insight-item">
      <div class="insight-icon"><i class="mdi mdi-trending-up"></i></div>
      <div>
        <div class="insight-title">Content Performance</div>
        <div class="insight-value">${postCount} posts, ${config.rssFeeds.length} active feeds</div>
      </div>
    </div>
  `;
  if (insights) {
    insightsElement.innerHTML += `
      <div class="insight-item">
        <div class="insight-icon"><i class="mdi mdi-chart-line"></i></div>
        <div>
          <div class="insight-title">Content Quality</div>
          <div class="insight-value">${(insights.contentQuality * 100).toFixed(0)}%</div>
        </div>
      </div>
      <div class="insight-item">
        <div class="insight-icon"><i class="mdi mdi-emoticon-happy"></i></div>
        <div>
          <div class="insight-title">Engagement Score</div>
          <div class="insight-value">${(insights.engagementScore * 100).toFixed(0)}%</div>
        </div>
      </div>
    `;
  }
}

function toggleAIFeature(feature) {
  const toggle = document.getElementById(`${feature}Toggle`);
  localStorage.setItem(`ai_${feature}`, toggle.checked);
  log(`${feature} ${toggle.checked ? 'enabled' : 'disabled'}`);
}

async function processFeeds() {
  if (!config.isConfigured()) {
    log('Bot not configured. Please set bot token and channel ID.');
    return;
  }

  for (const feed of config.rssFeeds) {
    try {
      const items = await rssReader.fetchFeed(feed.url);
      const lastItemKey = `${feed.url}_lastItem`;
      const lastProcessedDate = lastProcessedItems.get(lastItemKey);

      for (const item of items) {
        const itemDate = new Date(item.pubDate);
        
        if (!lastProcessedDate || itemDate > lastProcessedDate) {
          // Check content appropriateness
          const appropriatenessAnalysis = await analyzeContentAppropriateness(
            item.title + ' ' + item.description
          );
          
          if (appropriatenessAnalysis && appropriatenessAnalysis.isAppropriate && 
              appropriatenessAnalysis.contentRating !== '18+' && 
              appropriatenessAnalysis.contentRating !== 'R') {
            
            const isDuplicate = await isContentDuplicate(item.title + ' ' + item.description);
            
            if (!isDuplicate) {
              let formattedMessage = await formatTelegramMessage(
                `${item.title}\n\n${item.description}`, 
                item.link,
                feed.language
              );

              if (item.imageUrl) {
                // Analyze image content
                const imageAnalysis = await analyzeImage(item.imageUrl);
                
                if (imageAnalysis && imageAnalysis.isAppropriate && imageAnalysis.safetyRating !== 'unsafe') {
                  // Optimize caption with image analysis
                  const optimizedCaption = await optimizeImageCaption(imageAnalysis, formattedMessage);
                  
                  if (optimizedCaption) {
                    formattedMessage = optimizedCaption.caption;
                    if (optimizedCaption.hashtags.length > 0) {
                      formattedMessage += '\n\n' + optimizedCaption.hashtags.join(' ');
                    }
                  }

                  await bot.sendPhoto(config.channelId, item.imageUrl, formattedMessage);
                  log(`Posted new item with image from ${feed.url}`);
                } else {
                  // If image is inappropriate, post without image
                  await bot.sendMessage(config.channelId, formattedMessage);
                  log(`Posted new item without inappropriate image from ${feed.url}`);
                }
              } else {
                await bot.sendMessage(config.channelId, formattedMessage);
                log(`Posted new item without image from ${feed.url}`);
              }
              
              postCount++;
              lastProcessedItems.set(lastItemKey, itemDate);
              
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              log(`Skipped duplicate content from ${feed.url}`);
            }
          } else {
            log(`Skipped inappropriate content from ${feed.url}`);
            if (appropriatenessAnalysis && appropriatenessAnalysis.reasons) {
              appropriatenessAnalysis.reasons.forEach(reason => 
                log(`Content filter reason: ${reason}`)
              );
            }
          }
        }
      }
    } catch (error) {
      log(`Error processing feed ${feed.url}: ${error.message}`);
    }
  }
}

async function analyzeContentTrends() {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze content trends and patterns from recent posts.
        Return insights about topic distribution, engagement patterns, and recommendations.
        
        interface Response {
          topicDistribution: { [key: string]: number };
          engagementPatterns: {
            peakHours: number[];
            bestPerformingTopics: string[];
            userInteraction: number;
          };
          recommendations: {
            timing: string;
            topics: string[];
            contentStyle: string;
          };
        }`,
        data: {
          recentPosts: lastProcessedItems,
          postCount,
          timeRange: Date.now() - startTime
        }
      })
    });

    const trends = await response.json();
    updateTrendsDisplay(trends);
  } catch (error) {
    console.error('Error analyzing content trends:', error);
  }
}

async function optimizePostTiming() {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze optimal posting times based on engagement data.
        Consider time zones, user activity patterns, and content type.
        
        interface Response {
          optimalTimes: {
            hour: number;
            confidence: number;
            timezone: string;
          }[];
          recommendedFrequency: number;
          specialConsiderations: string[];
        }`,
        data: {
          postHistory: lastProcessedItems,
          engagementMetrics: postCount
        }
      })
    });

    const timing = await response.json();
    updatePostSchedule(timing);
  } catch (error) {
    console.error('Error optimizing post timing:', error);
  }
}

function updateTrendsDisplay(trends) {
  const trendsSection = document.createElement('div');
  trendsSection.className = 'insight-card animated-card';
  
  trendsSection.innerHTML = `
    <div class="insight-header">
      <div class="insight-icon">
        <i class="mdi mdi-trending-up"></i>
      </div>
      <h3>Content Trends</h3>
    </div>
    <div class="insight-content">
      <h4>Topic Distribution</h4>
      <div class="topic-distribution">
        ${Object.entries(trends.topicDistribution).map(([topic, percentage]) => `
          <div class="topic-bar">
            <span>${topic}</span>
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${percentage}%"></div>
            </div>
          </div>
        `).join('')}
      </div>
      
      <h4>Peak Engagement Hours</h4>
      <div class="peak-hours">
        ${trends.engagementPatterns.peakHours.map(hour => 
          `<span class="time-badge">${hour}:00</span>`
        ).join('')}
      </div>
      
      <h4>Recommendations</h4>
      <ul class="recommendations-list">
        <li>${trends.recommendations.timing}</li>
        <li>Focus on: ${trends.recommendations.topics.join(', ')}</li>
        <li>Style: ${trends.recommendations.contentStyle}</li>
      </ul>
    </div>
  `;
  
  const insightsPanel = document.getElementById('insights');
  insightsPanel.appendChild(trendsSection);
}

function updatePostSchedule(timing) {
  const scheduleSection = document.createElement('div');
  scheduleSection.className = 'insight-card animated-card';
  
  scheduleSection.innerHTML = `
    <div class="insight-header">
      <div class="insight-icon">
        <i class="mdi mdi-clock-outline"></i>
      </div>
      <h3>Optimal Posting Schedule</h3>
    </div>
    <div class="insight-content">
      <div class="optimal-times">
        ${timing.optimalTimes.map(time => `
          <div class="time-slot">
            <span class="time">${time.hour}:00</span>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width: ${time.confidence}%"></div>
            </div>
            <span class="timezone">${time.timezone}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="posting-frequency">
        <h4>Recommended Posting Frequency</h4>
        <p>${timing.recommendedFrequency} posts per day</p>
      </div>
      
      <div class="special-considerations">
        <h4>Special Considerations</h4>
        <ul>
          ${timing.specialConsiderations.map(consideration => 
            `<li>${consideration}</li>`
          ).join('')}
        </ul>
      </div>
    </div>
  `;
  
  const insightsPanel = document.getElementById('insights');
  insightsPanel.appendChild(scheduleSection);
}

async function startBot() {
  if (!config.isConfigured()) {
    showAlert('Please configure bot token and channel ID first', 'warning');
    return;
  }

  bot = new TelegramBot(config.botToken);
  botInterval = setInterval(processFeeds, 300000);
  startTime = Date.now();
  
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  
  updateBotStatus(true);
  log(' Bot started with enhanced AI features enabled');
  
  // Initialize AI features
  await analyzeContentTrends();
  await optimizePostTiming();
  
  processFeeds();
  
  setInterval(() => {
    updateStats();
    updateInsightPanel();
    analyzeContentTrends(); // Regularly update trends
  }, 3600000); // Update every hour
}

function stopBot() {
  clearInterval(botInterval);
  botInterval = null;
  bot = null;
  startTime = null;
  postCount = 0;
  
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  
  updateBotStatus(false);
  log(' Bot stopped');
}

async function showAIInsights() {
  try {
    const [contentInsights, visualInsights] = await Promise.all([
      fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Generate intelligent insights about content performance.
          
          interface Response {
            insights: {
              title: string;
              value: string;
              trend: 'up' | 'down' | 'stable';
              recommendation: string;
            }[];
            contentQuality: number;
            engagementScore: number;
            topPerformingTopics: string[];
          }`
        })
      }).then(r => r.json()),
      analyzeVisualContentTrends()
    ]);

    updateInsightPanel(contentInsights);
    showInsightModal({...contentInsights, visualInsights});
  } catch (error) {
    console.error('Error generating insights:', error);
  }
}

function showInsightModal(insights) {
  const modal = document.createElement('div');
  modal.className = 'insight-modal';
  
  modal.innerHTML = `
    <div class="insight-modal-content">
      <h3><i class="mdi mdi-lightbulb-on"></i> AI Insights</h3>
      
      <div class="insight-metrics">
        <div class="metric">
          <div class="metric-value">${(insights.contentQuality * 100).toFixed(0)}%</div>
          <div class="metric-label">Content Quality</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(insights.engagementScore * 100).toFixed(0)}%</div>
          <div class="metric-label">Engagement Score</div>
        </div>
      </div>
      <div class="insight-recommendations">
        ${insights.insights.map(insight => `
          <div class="insight-item">
            <div class="insight-header">
              <span>${insight.title}</span>
              <i class="mdi mdi-trending-${insight.trend}"></i>
            </div>
            <p>${insight.recommendation}</p>
          </div>
        `).join('')}
      </div>
      <div class="top-topics">
        <h4>Top Performing Topics</h4>
        <div class="topic-tags">
          ${insights.topPerformingTopics.map(topic => 
            `<span class="topic-tag">${topic}</span>`
          ).join('')}
        </div>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="cool-button">
        Close
      </button>
    </div>
  `;
  
  document.body.appendChild(modal);
}

async function updateLinkPreview(url) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Generate a preview for this URL with key information.
        
        interface Response {
          title: string;
          description: string;
          mainImage: string;
          type: 'article' | 'video' | 'podcast' | 'other';
          estimatedReadTime: number;
        }
        
        Example: {
          "title": "Breaking News Story",
          "description": "A comprehensive analysis...",
          "mainImage": "https://example.com/image.jpg",
          "type": "article",
          "estimatedReadTime": 5
        }`,
        data: url
      })
    });

    const preview = await response.json();
    updatePreviewCard(preview);
  } catch (error) {
    console.error('Error generating link preview:', error);
  }
}

async function analyzeContentQuality(content, language) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze content quality for ${language} audience.
        Consider cultural relevance, writing style, and engagement potential.
        
        interface Response {
          qualityScore: number;
          culturalRelevance: number;
          suggestions: string[];
          localContext: string[];
        }`,
        data: content
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error analyzing content quality:', error);
    return null;
  }
}

function convertToLocalCalendar(date, language) {
  const options = {
    calendar: language === 'fa' ? 'persian' : language === 'ar' ? 'islamic' : 'gregory',
    dateStyle: 'full',
    timeStyle: 'long'
  };
  
  return new Intl.DateTimeFormat(language, options).format(date);
}

async function analyzeImage(imageUrl) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze this image URL and provide insights about its content and appropriateness.
        
        interface Response {
          isAppropriate: boolean;
          contentDescription: string;
          detectedObjects: string[];
          suggestedTags: string[];
          visualQualityScore: number;
          safetyRating: 'safe' | 'moderate' | 'unsafe';
        }
        
        Example:
        {
          "isAppropriate": true,
          "contentDescription": "A scenic mountain landscape at sunset",
          "detectedObjects": ["mountains", "sun", "clouds", "trees"],
          "suggestedTags": ["nature", "landscape", "sunset", "mountains"],
          "visualQualityScore": 0.92,
          "safetyRating": "safe"
        }`,
        data: imageUrl
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error analyzing image:', error);
    return null;
  }
}



async function optimizeImageCaption(imageAnalysis, content) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Generate an optimized image caption combining image analysis and content.
        
        interface Response {
          caption: string;
          hashtags: string[];
          altText: string;
          engagement: {
            impact: number;
            readability: number;
          }
        }
        
        Example:
        {
          "caption": "Stunning mountain vista captures nature's majesty at golden hour",
          "hashtags": ["#NaturePhotography", "#Sunset", "#MountainViews"],
          "altText": "Mountains bathed in warm sunset light with dramatic cloud formations",
          "engagement": {
            "impact": 0.95,
            "readability": 0.88
          }
        }`,
        data: {
          imageAnalysis,
          content
        }
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error optimizing image caption:', error);
    return null;
  }
}

async function analyzeVisualContentTrends() {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze visual content trends from recent posts.
        Return insights about image patterns, engagement, and recommendations.
        
        interface Response {
          visualTrends: {
            dominantTypes: string[];
            performanceMetrics: {
              engagement: number;
              reach: number;
              impact: number;
            };
            recommendations: string[];
          };
          imageQuality: {
            average: number;
            improvement: string[];
          };
          optimization: {
            bestPractices: string[];
            suggestions: string[];
          };
        }`,
        data: {
          recentPosts: lastProcessedItems,
          postCount,
          timeRange: Date.now() - startTime
        }
      })
    });

    const trends = await response.json();
    updateVisualTrendsDisplay(trends);
  } catch (error) {
    console.error('Error analyzing visual content trends:', error);
  }
}

function updateVisualTrendsDisplay(trends) {
  const trendsSection = document.createElement('div');
  trendsSection.className = 'insight-card animated-card';
  
  trendsSection.innerHTML = `
    <div class="insight-header">
      <div class="insight-icon">
        <i class="mdi mdi-image-filter-hdr"></i>
      </div>
      <h3>Visual Content Analysis</h3>
    </div>
    <div class="insight-content">
      <h4>Dominant Content Types</h4>
      <div class="visual-trends">
        ${trends.visualTrends.dominantTypes.map(type => `
          <span class="trend-tag">${type}</span>
        `).join('')}
      </div>
      
      <h4>Performance Metrics</h4>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-value">${(trends.visualTrends.performanceMetrics.engagement * 100).toFixed(0)}%</div>
          <div class="metric-label">Engagement</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">${(trends.visualTrends.performanceMetrics.reach * 100).toFixed(0)}%</div>
          <div class="metric-label">Reach</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">${(trends.visualTrends.performanceMetrics.impact * 100).toFixed(0)}%</div>
          <div class="metric-label">Impact</div>
        </div>
      </div>
      
      <h4>Optimization Suggestions</h4>
      <ul class="optimization-list">
        ${trends.optimization.suggestions.map(suggestion => `
          <li>${suggestion}</li>
        `).join('')}
      </ul>
    </div>
  `;
  
  const insightsPanel = document.getElementById('insights');
  insightsPanel.appendChild(trendsSection);
}

function toggleMenu() {
  const menuPanel = document.querySelector('.menu-panel');
  menuPanel.classList.toggle('active');
}

function showDashboard() {
  toggleMenu();
  showPostingStatsModal();
}

async function showSettings() {
  toggleMenu();
  showCustomizationModal();
}

async function showAnalytics() {
  toggleMenu();
  
  // Enhanced SEO and analytics modal with real-time data
  const analytics = await fetch('/api/ai_completion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: `Analyze content performance and provide detailed analytics.
      Consider engagement metrics, content quality, and optimization opportunities.
      
      interface Response {
        contentMetrics: {
          quality: number;
          engagement: number;
          reach: number;
        };
        trends: {
          topics: string[];
          performance: string[];
          growth: number;
        };
        recommendations: {
          content: string[];
          timing: string[];
          strategy: string[];
        };
      }`
    })
  }).then(r => r.json());
  
  showAdvancedAnalyticsModal(analytics);
}

function showHelp() {
  toggleMenu();
  showEnhancedTutorial();
}

function showAdvancedAnalyticsModal(analytics) {
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content analytics-dashboard">
        <h3><i class="mdi mdi-chart-areaspline"></i> Advanced Analytics</h3>
        
        <div class="metrics-overview">
          <div class="metric-card">
            <div class="metric-header">
              <i class="mdi mdi-star-circle"></i>
              <h4>Content Quality</h4>
            </div>
            <div class="metric-value">${(analytics.contentMetrics.quality * 100).toFixed(1)}%</div>
            <div class="metric-trend positive">
              <i class="mdi mdi-trending-up"></i>
              <span>+${(analytics.trends.growth * 100).toFixed(1)}%</span>
            </div>
          </div>
          
          <div class="metric-card">
            <div class="metric-header">
              <i class="mdi mdi-account-group"></i>
              <h4>Engagement Rate</h4>
            </div>
            <div class="metric-value">${(analytics.contentMetrics.engagement * 100).toFixed(1)}%</div>
            <div class="metric-trend positive">
              <i class="mdi mdi-trending-up"></i>
              <span>+${(analytics.trends.growth * 100).toFixed(1)}%</span>
            </div>
          </div>
          
          <div class="metric-card">
            <div class="metric-header">
              <i class="mdi mdi-broadcast"></i>
              <h4>Content Reach</h4>
            </div>
            <div class="metric-value">${(analytics.contentMetrics.reach * 100).toFixed(1)}%</div>
            <div class="metric-trend positive">
              <i class="mdi mdi-trending-up"></i>
              <span>+${(analytics.trends.growth * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
        
        <div class="trends-analysis">
          <h4>Content Trends</h4>
          <div class="trends-grid">
            ${analytics.trends.topics.map((topic, index) => `
              <div class="trend-card">
                <div class="trend-info">
                  <span class="trend-topic">${topic}</span>
                  <span class="trend-performance">${analytics.trends.performance[index]}</span>
                </div>
                <div class="trend-chart">
                  <!-- Add dynamic chart visualization here -->
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="recommendations-section">
          <h4>AI-Powered Recommendations</h4>
          <div class="recommendations-grid">
            <div class="recommendation-card">
              <h5><i class="mdi mdi-lightbulb-on"></i> Content Strategy</h5>
              <ul>
                ${analytics.recommendations.content.map(rec => `
                  <li>${rec}</li>
                `).join('')}
              </ul>
            </div>
            
            <div class="recommendation-card">
              <h5><i class="mdi mdi-clock-outline"></i> Timing Optimization</h5>
              <ul>
                ${analytics.recommendations.timing.map(rec => `
                  <li>${rec}</li>
                `).join('')}
              </ul>
            </div>
            
            <div class="recommendation-card">
              <h5><i class="mdi mdi-strategy"></i> Growth Strategy</h5>
              <ul>
                ${analytics.recommendations.strategy.map(rec => `
                  <li>${rec}</li>
                `).join('')}
              </ul>
            </div>
          </div>
        </div>
        
        <button class="cool-button" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function showEnhancedTutorial() {
  const tutorialHtml = `
    <div class="tutorial-modal">
      <div class="tutorial-content">
        <h2><i class="mdi mdi-school"></i> Getting Started with RSS News Bot Manager Pro</h2>
        
        <div class="tutorial-steps">
          <div class="tutorial-step">
            <div class="step-header">
              <i class="mdi mdi-cog"></i>
              <h3>Initial Configuration</h3>
            </div>
            <div class="step-content">
              <p>Set up your bot by entering your Telegram Bot Token and Channel ID in the configuration section.</p>
              <div class="tutorial-tip">
                <i class="mdi mdi-lightbulb-on"></i>
                <span>Pro Tip: Test your connection before starting the bot to ensure everything is properly configured.</span>
              </div>
            </div>
          </div>
          
          <div class="tutorial-step">
            <div class="step-header">
              <i class="mdi mdi-rss"></i>
              <h3>Managing RSS Feeds</h3>
            </div>
            <div class="step-content">
              <p>Add RSS feeds by entering the URL and selecting the appropriate language. Our AI will automatically translate content to your chosen language.</p>
              <div class="tutorial-tip">
                <i class="mdi mdi-lightbulb-on"></i>
                <span>Pro Tip: Use multiple languages to reach a broader audience.</span>
              </div>
            </div>
          </div>
          
          <div class="tutorial-step">
            <div class="step-header">
              <i class="mdi mdi-brain"></i>
              <h3>AI Features</h3>
            </div>
            <div class="step-content">
              <p>Leverage our advanced AI features for content enhancement, sentiment analysis, and smart summarization.</p>
              <ul class="feature-list">
                <li>Content Enhancement: Improves readability and engagement</li>
                <li>Sentiment Analysis: Ensures appropriate content tone</li>
                <li>Smart Summarization: Creates concise, engaging summaries</li>
              </ul>
            </div>
          </div>
          
          <div class="tutorial-step">
            <div class="step-header">
              <i class="mdi mdi-chart-bar"></i>
              <h3>Analytics & Optimization</h3>
            </div>
            <div class="step-content">
              <p>Monitor performance and optimize your content strategy using our advanced analytics tools.</p>
              <div class="tutorial-tip">
                <i class="mdi mdi-lightbulb-on"></i>
                <span>Pro Tip: Regularly check analytics to optimize your posting strategy.</span>
              </div>
            </div>
          </div>
        </div>
        
        <button class="cool-button" onclick="closeTutorialAndShowMenu()">
          <i class="mdi mdi-check"></i> Got it!
        </button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', tutorialHtml);
  setTimeout(() => {
    document.querySelector('.tutorial-modal').classList.add('active');
  }, 100);
}


function closeTutorialAndShowMenu() {
  const tutorialModal = document.querySelector('.tutorial-modal');
  tutorialModal.classList.remove('active');
  setTimeout(() => {
    tutorialModal.remove();
    document.querySelector('.menu-panel').classList.add('active');
  }, 300);
}

// Enhanced RSS URL validation and analysis
async function validateAndAnalyzeRssUrl(url) {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Analyze this RSS feed URL for validity and content quality.
        Check feed structure, update frequency, and content relevance.
        
        interface Response {
          isValid: boolean;
          feedQuality: number;
          updateFrequency: string;
          contentCategories: string[];
          recommendations: string[];
          security: {
            isSecure: boolean;
            protocol: string;
            warnings: string[];
          };
        }`,
        data: url
      })
    });

    const analysis = await response.json();
    return analysis;
  } catch (error) {
    console.error('Error analyzing RSS URL:', error);
    return null;
  }
}

// Enhanced SEO Analysis
async function performAdvancedSEOAnalysis() {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Perform comprehensive SEO analysis of content.
        Consider multiple factors including keywords, meta tags, and content structure.
        
        interface Response {
          score: number;
          recommendations: {
            priority: 'high' | 'medium' | 'low';
            category: string;
            suggestion: string;
            impact: number;
          }[];
          keywords: {
            term: string;
            density: number;
            competition: number;
            trend: 'up' | 'down' | 'stable';
          }[];
          contentStructure: {
            readability: number;
            headingStructure: string;
            contentDepth: number;
          };
          technicalSEO: {
            loadSpeed: number;
            mobileFriendly: boolean;
            structuredData: boolean;
          };
        }`,
        data: {
          content: document.querySelector('.content-preview')?.innerHTML,
          url: document.getElementById('rssUrl').value
        }
      })
    });

    const seoAnalysis = await response.json();
    showAdvancedSEOResults(seoAnalysis);
  } catch (error) {
    console.error('Error performing SEO analysis:', error);
  }
}

function showAdvancedSEOResults(analysis) {
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content seo-dashboard">
        <h3><i class="mdi mdi-chart-bar"></i> Advanced SEO Analysis</h3>
        
        <div class="seo-score-section">
          <div class="score-circle" style="--score: ${analysis.score}%">
            <div class="score-value">${Math.round(analysis.score)}</div>
          </div>
          <div class="score-label">Overall SEO Score</div>
        </div>
        
        <div class="seo-recommendations">
          <h4>Priority Recommendations</h4>
          <div class="recommendations-grid">
            ${analysis.recommendations.map(rec => `
              <div class="recommendation-card priority-${rec.priority}">
                <div class="rec-header">
                  <span class="rec-category">${rec.category}</span>
                  <span class="rec-priority">${rec.priority}</span>
                </div>
                <p>${rec.suggestion}</p>
                <div class="impact-meter" style="--impact: ${rec.impact}%"></div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="keyword-analysis">
          <h4>Keyword Analysis</h4>
          <div class="keyword-grid">
            ${analysis.keywords.map(kw => `
              <div class="keyword-card">
                <div class="keyword-header">
                  <span class="keyword-term">${kw.term}</span>
                  <span class="keyword-trend ${kw.trend}">
                    <i class="mdi mdi-trending-${kw.trend}"></i>
                  </span>
                </div>
                <div class="keyword-metrics">
                  <div class="metric">
                    <span>Density</span>
                    <div class="metric-bar" style="--value: ${kw.density}%"></div>
                  </div>
                  <div class="metric">
                    <span>Competition</span>
                    <div class="metric-bar" style="--value: ${kw.competition}%"></div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="technical-seo">
          <h4>Technical SEO</h4>
          <div class="technical-metrics">
            <div class="metric-item">
              <span>Load Speed</span>
              <div class="speed-meter" style="--speed: ${analysis.technicalSEO.loadSpeed}%"></div>
            </div>
            <div class="metric-item">
              <span>Mobile Friendly</span>
              <i class="mdi mdi-${analysis.technicalSEO.mobileFriendly ? 'check' : 'close'}"></i>
            </div>
            <div class="metric-item">
              <span>Structured Data</span>
              <i class="mdi mdi-${analysis.technicalSEO.structuredData ? 'check' : 'close'}"></i>
            </div>
          </div>
        </div>
        
        <button class="cool-button" onclick="closeModal()">Close Analysis</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Add URL and RSS validation when adding new feed
async function addRssFeed() {
  const url = document.getElementById('rssUrl').value;
  const language = document.getElementById('feedLanguage').value;
  
  if (url) {
    const urlAnalysis = await validateAndAnalyzeRssUrl(url);
    
    if (urlAnalysis && urlAnalysis.isValid) {
      if (config.addRssFeed(url, language)) {
        updateRssList();
        document.getElementById('rssUrl').value = '';
        log(` Added RSS feed: ${url} (${language})`);
        updateLanguageDirection(language);
        
        // Show feed analysis
        showFeedAnalysisModal(urlAnalysis);
      } else {
        log(' RSS feed already exists');
      }
    } else {
      showAlert('Invalid RSS feed URL or feed not accessible', 'error');
    }
  }
}

function showFeedAnalysisModal(analysis) {
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content feed-analysis">
        <h3><i class="mdi mdi-rss"></i> Feed Analysis</h3>
        
        <div class="feed-quality">
          <div class="quality-score">
            <div class="score-circle" style="--score: ${analysis.feedQuality * 100}%">
              ${Math.round(analysis.feedQuality * 100)}
            </div>
          </div>
        </div>
        
        <div class="feed-metrics">
          <div class="metric-item">
            <i class="mdi mdi-clock-outline"></i>
            <span>Update Frequency</span>
            <strong>${analysis.updateFrequency}</strong>
          </div>
          
          <div class="metric-item">
            <i class="mdi mdi-folder-multiple"></i>
            <span>Content Categories</span>
            <div class="category-tags">
              ${analysis.contentCategories.map(cat => `
                <span class="category-tag">${cat}</span>
              `).join('')}
            </div>
          </div>
        </div>
        
        <div class="feed-security">
          <h4>Security Analysis</h4>
          <div class="security-status ${analysis.security.isSecure ? 'secure' : 'warning'}">
            <i class="mdi mdi-${analysis.security.isSecure ? 'shield-check' : 'shield-alert'}"></i>
            <span>${analysis.security.isSecure ? 'Secure Feed' : 'Security Concerns'}</span>
          </div>
          <div class="security-details">
            <p>Protocol: ${analysis.security.protocol}</p>
            ${analysis.security.warnings.length > 0 ? `
              <div class="security-warnings">
                ${analysis.security.warnings.map(warning => `
                  <div class="warning-item">
                    <i class="mdi mdi-alert"></i>
                    <span>${warning}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
        
        <div class="recommendations">
          <h4>Recommendations</h4>
          <ul class="recommendation-list">
            ${analysis.recommendations.map(rec => `
              <li><i class="mdi mdi-lightbulb-on"></i> ${rec}</li>
            `).join('')}
          </ul>
        </div>
        
        <button class="cool-button" onclick="closeModal()">
          <i class="mdi mdi-check"></i> Got it!
        </button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// ... rest of existing code ...

function showSEOAnalysisModal() {
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content seo-analysis">
        <h3><i class="mdi mdi-magnify"></i> SEO Analysis</h3>
        
        <div class="seo-tools">
          <div class="tool-section">
            <h4>Content Analysis</h4>
            <button class="tool-button" onclick="analyzeSEOContent()">
              <i class="mdi mdi-file-document-outline"></i>
              Analyze Content
            </button>
          </div>
          
          <div class="tool-section">
            <h4>Keyword Research</h4>
            <button class="tool-button" onclick="researchKeywords()">
              <i class="mdi mdi-tag-multiple"></i>
              Research Keywords
            </button>
          </div>
          
          <div class="tool-section">
            <h4>Meta Tags Generator</h4>
            <button class="tool-button" onclick="generateMetaTags()">
              <i class="mdi mdi-code-tags"></i>
              Generate Tags
            </button>
          </div>
        </div>
        
        <div id="seoResults" class="seo-results"></div>
        
        <button class="cool-button" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function analyzeSEOContent() {
  const results = await fetch('/api/ai_completion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: `Analyze recent posts for SEO optimization.
      Consider keyword density, readability, and meta description quality.
      
      interface Response {
        score: number;
        recommendations: string[];
        keywords: string[];
        readabilityScore: number;
      }`
    })
  }).then(r => r.json());
  
  updateSEOResults(results);
}

function updateSEOResults(results) {
  const resultsDiv = document.getElementById('seoResults');
  resultsDiv.innerHTML = `
    <div class="seo-score">
      <div class="score-circle" style="--score: ${results.score * 100}%">
        ${Math.round(results.score * 100)}
      </div>
      <span>SEO Score</span>
    </div>
    
    <div class="seo-recommendations">
      <h4>Recommendations</h4>
      <ul>
        ${results.recommendations.map(rec => `<li>${rec}</li>`).join('')}
      </ul>
    </div>
    
    <div class="keyword-analysis">
      <h4>Top Keywords</h4>
      <div class="keyword-cloud">
        ${results.keywords.map(kw => `<span class="keyword">${kw}</span>`).join('')}
      </div>
    </div>
  `;
}

function closeModal() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) {
    modal.classList.add('fade-out');
    setTimeout(() => modal.remove(), 300);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateRssList();
  updateStats();
  
  document.getElementById('botToken').value = config.botToken;
  document.getElementById('channelId').value = config.channelId;
  
  // Initialize AI features if bot is already running
  if (botInterval) {
    analyzeContentTrends();
    optimizePostTiming();
  }
  
  // Load saved theme settings
  const savedColor = localStorage.getItem('theme_--primary-color');
  if (savedColor) {
    document.documentElement.style.setProperty('--primary-color', savedColor);
  }
  
  const compactMode = localStorage.getItem('compact_mode') === 'true';
  if (compactMode) {
    document.body.classList.add('compact-mode');
  }
  
  const darkMode = localStorage.getItem('dark_mode') === 'true';
  if (darkMode) {
    document.body.classList.add('dark-mode');
  }
  
  const fontFamily = localStorage.getItem('font_family');
  if (fontFamily) {
    document.body.style.fontFamily = fontFamily;
  }
  
  const fontSize = localStorage.getItem('font_size');
  if (fontSize) {
    document.body.style.fontSize = `${fontSize}px`;
  }
});

async function analyzePostingStats() {
  const postsData = Array.from(lastProcessedItems.entries());
  
  const stats = {
    totalPosts: postCount,
    postsPerHour: postCount / (((Date.now() - startTime) / 1000 / 60 / 60) || 1),
    successRate: ((postCount / (postsData.length || 1)) * 100).toFixed(1),
    topPerformingFeeds: []
  };

  const feedStats = new Map();
  postsData.forEach(([feed, date]) => {
    if (!feedStats.has(feed)) {
      feedStats.set(feed, 0);
    }
    feedStats.set(feed, feedStats.get(feed) + 1);
  });

  stats.topPerformingFeeds = Array.from(feedStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([feed, count]) => ({
      feed,
      count,
      percentage: ((count / postCount) * 100).toFixed(1)
    }));

  return stats;
}

async function showPostingStatsModal() {
  const stats = await analyzePostingStats();
  
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content posting-stats">
        <h3><i class="mdi mdi-chart-bar"></i> Posting Statistics</h3>
        
        <div class="stats-grid">
          <div class="stat-item">
            <div class="stat-value">${stats.totalPosts}</div>
            <div class="stat-label">Total Posts</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.postsPerHour.toFixed(1)}</div>
            <div class="stat-label">Posts/Hour</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${stats.successRate}%</div>
            <div class="stat-label">Success Rate</div>
          </div>
        </div>
        
        <div class="top-feeds">
          <h4>Top Performing Feeds</h4>
          ${stats.topPerformingFeeds.map(feed => `
            <div class="feed-stat">
              <div class="feed-url">${feed.feed}</div>
              <div class="feed-metrics">
                <span>${feed.count} posts</span>
                <span>${feed.percentage}%</span>
              </div>
            </div>
          `).join('')}
        </div>
        
        <button class="cool-button" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function showCustomizationModal() {
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content customization-panel">
        <h3><i class="mdi mdi-palette"></i> Page Customization</h3>
        
        <div class="customization-section">
          <h4>Theme Settings</h4>
          <div class="color-picker">
            <label>Primary Color</label>
            <input type="color" onchange="updateThemeColor(this.value, '--primary-color')" value="#2563eb">
          </div>
          <div class="color-picker">
            <label>Background Color</label>
            <input type="color" onchange="updateThemeColor(this.value, '--background-color')" value="#f0f4f8">
          </div>
        </div>
        
        <div class="customization-section">
          <h4>Layout Options</h4>
          <label class="toggle-switch">
            <input type="checkbox" onchange="toggleCompactMode(this.checked)">
            <span class="toggle-slider"></span>
            Compact Mode
          </label>
          <label class="toggle-switch">
            <input type="checkbox" onchange="toggleDarkMode(this.checked)">
            <span class="toggle-slider"></span>
            Dark Mode
          </label>
        </div>
        
        <div class="customization-section">
          <h4>Font Settings</h4>
          <select onchange="updateFontFamily(this.value)">
            <option value="'Segoe UI', sans-serif">Segoe UI</option>
            <option value="'Roboto', sans-serif">Roboto</option>
            <option value="'Open Sans', sans-serif">Open Sans</option>
          </select>
          <input type="range" min="12" max="20" value="16" onchange="updateFontSize(this.value)">
        </div>
        
        <button class="cool-button" onclick="closeModal()">Save Changes</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function updateThemeColor(color, variable) {
  document.documentElement.style.setProperty(variable, color);
  localStorage.setItem(`theme_${variable}`, color);
}

function toggleCompactMode(enabled) {
  document.body.classList.toggle('compact-mode', enabled);
  localStorage.setItem('compact_mode', enabled);
}

function toggleDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
  localStorage.setItem('dark_mode', enabled);
}

function updateFontFamily(font) {
  document.body.style.fontFamily = font;
  localStorage.setItem('font_family', font);
}


function updateFontSize(size) {
  document.body.style.fontSize = `${size}px`;
  localStorage.setItem('font_size', size);
}

async function generateContentSuggestions() {
  try {
    const response = await fetch('/api/ai_completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Based on current content performance and trends, suggest optimal content strategies.
        
        interface Response {
          topPerformingFormats: {
            format: string;
            engagementRate: number;
            recommendation: string;
          }[];
          contentGaps: string[];
          audienceInsights: {
            demographics: string[];
            interests: string[];
            behavior: string[];
          };
          optimizationTips: {
            category: string;
            tips: string[];
          }[];
        }`
      })
    });

    const suggestions = await response.json();
    showContentSuggestionsModal(suggestions);
  } catch (error) {
    console.error('Error generating content suggestions:', error);
  }
}

function showContentSuggestionsModal(suggestions) {
  const modalHtml = `
    <div class="modal-overlay">
      <div class="modal-content content-suggestions">
        <h3><i class="mdi mdi-lightbulb-on"></i> Content Strategy Insights</h3>
        
        <div class="performance-formats">
          <h4>Top Performing Content Formats</h4>
          <div class="formats-grid">
            ${suggestions.topPerformingFormats.map(format => `
              <div class="format-card">
                <div class="format-header">
                  <i class="mdi mdi-${getFormatIcon(format.format)}"></i>
                  <h5>${format.format}</h5>
                </div>
                <div class="engagement-rate">
                  <div class="rate-bar" style="--rate: ${format.engagementRate * 100}%"></div>
                  <span>${(format.engagementRate * 100).toFixed(1)}% Engagement</span>
                </div>
                <p>${format.recommendation}</p>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="content-opportunities">
          <h4>Content Gap Opportunities</h4>
          <div class="opportunities-grid">
            ${suggestions.contentGaps.map(gap => `
              <div class="opportunity-card">
                <i class="mdi mdi-target"></i>
                <p>${gap}</p>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="audience-insights">
          <h4>Audience Insights</h4>
          <div class="insights-grid">
            <div class="insight-category">
              <h5><i class="mdi mdi-account-group"></i> Demographics</h5>
              <ul>
                ${suggestions.audienceInsights.demographics.map(demo => `
                  <li>${demo}</li>
                `).join('')}
              </ul>
            </div>
            <div class="insight-category">
              <h5><i class="mdi mdi-heart"></i> Interests</h5>
              <ul>
                ${suggestions.audienceInsights.interests.map(interest => `
                  <li>${interest}</li>
                `).join('')}
              </ul>
            </div>
            <div class="insight-category">
              <h5><i class="mdi mdi-chart-bubble"></i> Behavior</h5>
              <ul>
                ${suggestions.audienceInsights.behavior.map(behavior => `
                  <li>${behavior}</li>
                `).join('')}
              </ul>
            </div>
          </div>
        </div>
        
        <div class="optimization-tips">
          <h4>Content Optimization Tips</h4>
          ${suggestions.optimizationTips.map(tip => `
            <div class="tip-category">
              <h5>${tip.category}</h5>
              <ul>
                ${tip.tips.map(t => `<li>${t}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
        
        <button class="cool-button" onclick="closeModal()">
          <i class="mdi mdi-check"></i> Got it!
        </button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function getFormatIcon(format) {
  const icons = {
    'News Articles': 'newspaper',
    'Videos': 'video',
    'Infographics': 'chart-bar',
    'Tutorials': 'school',
    'Lists': 'format-list-bulleted',
    'Case Studies': 'file-document',
    'default': 'file'
  };
  return icons[format] || icons.default;
}

async function showContentSuggestions() {
  toggleMenu();
  generateContentSuggestions();
}