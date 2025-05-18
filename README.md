# Anilist to Satoru.one Mapper

This is a simple API that maps Anilist anime IDs to Satoru.one video sources. It works by:

1. Taking an Anilist ID and episode number
2. Converting the ID to an anime title using the Anilist GraphQL API
3. Searching for that title on Satoru.one
4. Finding the specific episode by number
5. Extracting all available video sources for that episode
6. For cdn.buycodeonline.com sources, extracts direct m3u8 links automatically

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/saturo.git
cd saturo

# Install dependencies
npm install
```

## Local Development

```bash
# Start the server
npm start

# For development with auto-restart
npm run dev
```

The server will run on `http://localhost:3000`.

## Vercel Deployment

This API is configured for deployment on Vercel. To deploy:

1. Fork this repository
2. Connect to Vercel
3. Import the project
4. Deploy!

No additional configuration is required as the `vercel.json` file is already set up.

## API Endpoint

### GET `/mapper/{anilistId}-episode-{number}`

Gets video source links for a specific episode of an anime by its AniList ID and episode number.

#### Parameters

- `:anilistId` - The AniList ID of the anime
- `:number` - The episode number

#### Example Request

```
GET https://your-vercel-url.vercel.app/mapper/1-episode-1
```

#### Example Response

```json
{
  "success": true,
  "episodeId": "101",
  "servers": 2,
  "sources": [
    {
      "id": "3786",
      "serverId": "6",
      "name": "Fast",
      "source": {
        "type": "m3u8",
        "link": "https://stream.buycodeonline.com/vid/stream/1896-eoOcI/master.m3u8",
        "server": 6
      }
    },
    {
      "id": "302",
      "serverId": "4",
      "name": "xStream",
      "source": {
        "type": "iframe",
        "link": "https://boosterx.stream/v/aFW5qHaWuNpc/",
        "server": 4
      }
    }
  ]
}
```

Note: For cdn.buycodeonline.com sources, the type is changed to "m3u8" and the link points directly to the video stream.

#### Error Response

```json
{
  "success": false,
  "error": "Episode 1 not found"
}
```

## License

ISC 