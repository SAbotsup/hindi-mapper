const express = require('express');
const axios = require('axios');
const app = express();

// Middleware
app.use(express.json());

// Configure axios with default headers
const satoruAxios = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://www.satoru.one/',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
  }
});

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Function to calculate Levenshtein distance between two strings
function levenshteinDistance(str1, str2) {
  const track = Array(str2.length + 1).fill(null).map(() => 
    Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i += 1) {
    track[0][i] = i;
  }
  
  for (let j = 0; j <= str2.length; j += 1) {
    track[j][0] = j;
  }
  
  for (let j = 1; j <= str2.length; j += 1) {
    for (let i = 1; i <= str1.length; i += 1) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return track[str2.length][str1.length];
}

// Function to normalize a title for better matching
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();                 // Trim whitespace
}

// Function to calculate string similarity (0-1 scale, 1 being identical)
function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  // Normalize strings for comparison
  const normalizedStr1 = normalizeTitle(str1);
  const normalizedStr2 = normalizeTitle(str2);
  
  // If strings are identical after normalization
  if (normalizedStr1 === normalizedStr2) return 1;
  
  // Calculate Levenshtein distance
  const distance = levenshteinDistance(normalizedStr1, normalizedStr2);
  
  // Calculate similarity as a value between 0 and 1
  const maxLength = Math.max(normalizedStr1.length, normalizedStr2.length);
  const similarity = maxLength > 0 ? 1 - distance / maxLength : 1;
  
  return similarity;
}

// Function to fetch anime title from AniList API by ID
async function getAnimeTitle(anilistId) {
  try {
    // GraphQL query to get anime details from AniList
    const query = `
      query ($id: Int) {
        Media (id: $id, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          synonyms
        }
      }
    `;

    // Make the request to AniList API
    const response = await axios.post('https://graphql.anilist.co', {
      query,
      variables: {
        id: parseInt(anilistId)
      }
    });

    // Get the anime title (prefer English, fallback to romaji)
    const animeData = response.data.data.Media;
    let title = animeData.title.english || animeData.title.romaji;
    
    // Get synonyms for fallback searches
    const synonyms = animeData.synonyms || [];
    
    // Remove (TV), (OVA), etc. from title
    title = title.replace(/\s*\([^)]*\)\s*$/, '');
    
    // Return the title and synonyms
    return {
      title,
      synonyms
    };
  } catch (error) {
    throw new Error('Failed to fetch anime title from AniList');
  }
}

// Helper function to extract Satoru ID from HTML using various methods
function extractSatoruIdFromHtml(html, formattedTitle, originalTitle) {
  // Try to extract all possible titles and their data-ids
  const matches = [];
  
  // Extract all film-poster-ahref elements with data-ids
  const filmPosterPattern = /<a [^>]*class="film-poster-ahref[^"]*"[^>]* data-id="(\d+)"[^>]*title="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = filmPosterPattern.exec(html)) !== null) {
    const dataId = match[1];
    const title = match[2];
    matches.push({ dataId, title });
  }
  
  // If the extraction above didn't work, try another pattern
  if (matches.length === 0) {
    // Extract all data-ids
    const idPattern = /<a [^>]*class="film-poster-ahref[^"]*"[^>]* data-id="(\d+)"[^>]*>/gi;
    const ids = [];
    while ((match = idPattern.exec(html)) !== null) {
      ids.push(match[1]);
    }
    
    // Extract all titles
    const titlePattern = /<a href="[^"]+" title="([^"]+)" class="dynamic-name"[^>]*>/gi;
    const titles = [];
    while ((match = titlePattern.exec(html)) !== null) {
      titles.push(match[1]);
    }
    
    // If we have same number of ids and titles, assume they match
    if (ids.length > 0 && ids.length === titles.length) {
      for (let i = 0; i < ids.length; i++) {
        matches.push({ dataId: ids[i], title: titles[i] });
      }
    } else if (ids.length > 0) {
      // If we have ids but no matching titles, use the first id
      return ids[0];
    }
  }
  
  // If we found any matches, find the best one using string similarity
  if (matches.length > 0) {
    // Calculate similarity for each match
    matches.forEach(item => {
      item.exactSimilarity = calculateStringSimilarity(originalTitle, item.title);
      
      // Also try without parentheses content
      const titleWithoutParentheses = originalTitle.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      const matchTitleWithoutParentheses = item.title.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      item.cleanSimilarity = calculateStringSimilarity(titleWithoutParentheses, matchTitleWithoutParentheses);
      
      // Try with first few words only (for titles that have a different suffix/season indicator)
      const words = originalTitle.split(' ');
      const matchWords = item.title.split(' ');
      const shortOriginalTitle = words.slice(0, Math.min(3, words.length)).join(' ');
      const shortMatchTitle = matchWords.slice(0, Math.min(3, matchWords.length)).join(' ');
      item.shortSimilarity = calculateStringSimilarity(shortOriginalTitle, shortMatchTitle);
      
      // Use the best similarity score
      item.similarity = Math.max(item.exactSimilarity, item.cleanSimilarity, item.shortSimilarity);
    });
    
    // Sort by similarity (highest first)
    matches.sort((a, b) => b.similarity - a.similarity);
    
    // Use the best match if it has reasonable similarity (>= 0.5)
    const bestMatch = matches[0];
    if (bestMatch.similarity >= 0.5) {
      return bestMatch.dataId;
    } else {
      // Fall back to first result if no good match
      return matches[0].dataId;
    }
  }
  
  // Fallback to the old method if no matches found using similarity
  const simpleFilmPosterPattern = /<a [^>]*class="film-poster-ahref[^"]*"[^>]* data-id="(\d+)"[^>]*>/gi;
  let lastDataId = null;
  
  while ((match = simpleFilmPosterPattern.exec(html)) !== null) {
    lastDataId = match[1];
  }
  
  if (lastDataId) {
    // Try to get the title for this ID to verify
    const titlePattern = /<a href="[^"]+" title="([^"]+)" class="dynamic-name"/i;
    const titleMatch = titlePattern.exec(html);
    
    return lastDataId;
  }
  
  return null;
}

// Helper function to search Satoru.one with a specific title
async function searchSatoruWithTitle(formattedTitle, originalTitle) {
  try {
    // Make request to Satoru.one search
    const url = `https://www.satoru.one/filter?keyword=${formattedTitle}`;
    
    const response = await satoruAxios.get(url);
    
    // Extract the anime ID from the HTML response
    const html = response.data;
    
    // Try to extract the ID using various methods
    return extractSatoruIdFromHtml(html, formattedTitle, originalTitle);
  } catch (error) {
    return null;
  }
}

// Function to search anime on Satoru.one and get anime ID
async function getSatoruId(title, synonyms = []) {
  try {
    // Format title for URL (replace spaces with plus signs)
    const formattedTitle = title.replace(/\s+/g, '+');
    
    // Try to find the ID using the full title first
    let satoruId = await searchSatoruWithTitle(formattedTitle, title);
    if (satoruId) return satoruId;
    
    // If full title search failed, try with first 2-3 words
    const words = title.split(' ');
    if (words.length > 2) {
      // Try with first 3 words
      if (words.length >= 3) {
        const shortTitle = words.slice(0, 3).join(' ');
        const shortFormattedTitle = shortTitle.replace(/\s+/g, '+');
        satoruId = await searchSatoruWithTitle(shortFormattedTitle, title);
        if (satoruId) return satoruId;
      }
      
      // Try with first 2 words
      const veryShortTitle = words.slice(0, 2).join(' ');
      const veryShortFormattedTitle = veryShortTitle.replace(/\s+/g, '+');
      satoruId = await searchSatoruWithTitle(veryShortFormattedTitle, title);
      if (satoruId) return satoruId;
    }
    
    // Try with synonyms if available
    if (synonyms && synonyms.length > 0) {
      for (const synonym of synonyms) {
        if (synonym && synonym.trim()) {
          const formattedSynonym = synonym.replace(/\s+/g, '+');
          satoruId = await searchSatoruWithTitle(formattedSynonym, synonym);
          if (satoruId) {
            return satoruId;
          }
        }
      }
    }
    
    // If all searches failed
    throw new Error('Anime ID not found on Satoru.one');
  } catch (error) {
    throw new Error('Failed to find anime on Satoru.one');
  }
}

// Function to get episode list from Satoru.one
async function getEpisodeList(satoruId) {
  try {
    // Make request to get episode list
    const url = `https://www.satoru.one/ajax/episode/list/${satoruId}`;
    
    const response = await satoruAxios.get(url);
    
    // Parse the HTML response to extract episode information
    const htmlContent = response.data.html;
    
    // Extract episodes data using regex
    const episodes = [];
    const episodePattern = /<a title="([^"]*)" class="ssl-item[^"]*" data-number="(\d+)" data-id="(\d+)" href="([^"]+)">/g;
    
    let match;
    while ((match = episodePattern.exec(htmlContent)) !== null) {
      episodes.push({
        title: match[1],
        number: match[2],
        id: match[3],
        url: match[4]
      });
    }
    
    return episodes;
  } catch (error) {
    throw new Error('Failed to fetch episode list from Satoru.one');
  }
}

// Function to get episode servers from Satoru.one
async function getEpisodeServers(episodeId) {
  try {
    // Make request to get episode servers
    const url = `https://www.satoru.one/ajax/episode/servers?episodeId=${episodeId}`;
    
    const response = await satoruAxios.get(url);
    
    // Parse the HTML response to extract server information
    const htmlContent = response.data.html;
    
    // Extract server data using regex
    const servers = [];
    const serverPattern = /<div class="server-item" data-type="[^"]*" data-id="(\d+)" data-server-id="(\d+)">\s*<a[^>]*>([^<]+)<\/a>/g;
    
    let match;
    while ((match = serverPattern.exec(htmlContent)) !== null) {
      servers.push({
        id: match[1],
        serverId: match[2],
        name: match[3].trim()
      });
    }
    
    return servers;
  } catch (error) {
    throw new Error('Failed to fetch episode servers from Satoru.one');
  }
}

// Function to extract m3u8 link from buycodeonline domain
async function extractM3u8FromBuyCodeOnline(iframeUrl) {
  try {
    // Make request to the iframe URL
    const response = await satoruAxios.get(iframeUrl);
    
    // Parse the HTML content
    const html = response.data;
    
    // Extract the m3u8 URL using regex
    const m3u8Pattern = /const\s+mastreUrl\s*=\s*['"]([^'"]+\.m3u8)['"]/;
    const match = m3u8Pattern.exec(html);
    
    if (match && match[1]) {
      return match[1]; // Return the m3u8 URL
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Function to get episode source from Satoru.one
async function getEpisodeSource(sourceId) {
  try {
    // Make request to get episode source
    const url = `https://www.satoru.one/ajax/episode/sources?id=${sourceId}`;
    
    const response = await satoruAxios.get(url);
    
    // Get the source data
    const sourceData = response.data;
    
    // If it's from buycodeonline domain, try to extract the m3u8 link
    if (sourceData.link && sourceData.link.includes('cdn.buycodeonline.com')) {
      try {
        const m3u8Link = await extractM3u8FromBuyCodeOnline(sourceData.link);
        if (m3u8Link) {
          // Replace the source data with just the m3u8 link
          return {
            type: "m3u8",
            link: m3u8Link,
            server: sourceData.server
          };
        }
      } catch (error) {
        // Ignore extraction errors
      }
    }
    
    // Return the source data unchanged for other sources
    return sourceData;
  } catch (error) {
    throw new Error('Failed to fetch episode source from Satoru.one');
  }
}

// Root route for health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

// Combined endpoint for getting episode sources by AniList ID and episode number
app.get('/mapper/:anilistId-episode-:number', async (req, res) => {
  try {
    const { anilistId, number } = req.params;
    
    // Step 1: Get anime title from AniList
    const animeData = await getAnimeTitle(anilistId);
    
    // Step 2: Get Satoru.one ID from the title
    const satoruId = await getSatoruId(animeData.title, animeData.synonyms);
    
    // Step 3: Get episode list from Satoru.one
    const episodes = await getEpisodeList(satoruId);
    
    // Step 4: Find the specific episode by number
    const episode = episodes.find(ep => ep.number === number);
    
    if (!episode) {
      return res.status(404).json({
        success: false,
        error: `Episode ${number} not found`
      });
    }
    
    // Step 5: Get servers for the episode
    const servers = await getEpisodeServers(episode.id);
    
    if (!servers || servers.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No servers found for this episode'
      });
    }
    
    // Step 6: Get source for each server
    const sources = [];
    for (const server of servers) {
      try {
        const source = await getEpisodeSource(server.id);
        sources.push({
          ...server,
          source
        });
      } catch (error) {
        // Skip failed sources
      }
    }
    
    // Return the response
    res.json({
      success: true,
      episodeId: episode.id,
      servers: servers.length,
      sources
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// For local development
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export the Express API for Vercel
module.exports = app; 