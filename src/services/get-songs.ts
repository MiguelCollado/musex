/* eslint-disable */
import {inject, injectable} from 'inversify';
import * as cheerio from 'cheerio';
import * as spotifyURI from 'spotify-uri';
import {MediaSource, QueuedPlaylist, SongMetadata} from './player.js';
import {TYPES} from '../types.js';
import ffmpeg from 'fluent-ffmpeg';
import YoutubeAPI from './youtube-api.js';
import SpotifyAPI, {SpotifyTrack} from './spotify-api.js';
import {AudioInfo, SunoAPI} from './suno-api.js';

@injectable()
export default class {
  private readonly youtubeAPI: YoutubeAPI;
  private readonly spotifyAPI: SpotifyAPI;
  private readonly sunoAPI: SunoAPI;

  constructor(@inject(TYPES.Services.YoutubeAPI) youtubeAPI: YoutubeAPI, @inject(TYPES.Services.SpotifyAPI) spotifyAPI: SpotifyAPI, @inject(TYPES.Services.SunoAPI) sunoAPI: SunoAPI) {
    this.youtubeAPI = youtubeAPI;
    this.spotifyAPI = spotifyAPI;
    this.sunoAPI = sunoAPI;
  }

  async youtubeVideoSearch(query: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.search(query, shouldSplitChapters);
  }

  async youtubeVideo(url: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getVideo(url, shouldSplitChapters);
  }

  async youtubePlaylist(listId: string, shouldSplitChapters: boolean): Promise<SongMetadata[]> {
    return this.youtubeAPI.getPlaylist(listId, shouldSplitChapters);
  }

  async spotifySource(url: string, playlistLimit: number, shouldSplitChapters: boolean): Promise<[SongMetadata[], number, number]> {
    const parsed = spotifyURI.parse(url);

    switch (parsed.type) {
      case 'album': {
        const [tracks, playlist] = await this.spotifyAPI.getAlbum(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters, playlist);
      }

      case 'playlist': {
        const [tracks, playlist] = await this.spotifyAPI.getPlaylist(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters, playlist);
      }

      case 'track': {
        const tracks = [await this.spotifyAPI.getTrack(url)];
        return this.spotifyToYouTube(tracks, shouldSplitChapters);
      }

      case 'artist': {
        const tracks = await this.spotifyAPI.getArtist(url, playlistLimit);
        return this.spotifyToYouTube(tracks, shouldSplitChapters);
      }

      default: {
        return [[], 0, 0];
      }
    }
  }

  async sunoSource(url: string): Promise<SongMetadata[]> {
    // https://suno.com/song/1a95710f-17fa-41fc-9477-c63f4bafb1f7
    const parsedUrl = new URL(url);
    const songId = parsedUrl.pathname.split('/')[2];

    let tracks: AudioInfo[] | {detail: string}[] = [];
    try {
      const songInfo = await this.getMetadataFromHTML(songId);
      tracks = [{
        title: songInfo.title,
        duration: '120',
        image_url: songInfo.image,
        created_at: '2021-10-10T00:00:00Z',
        model_name: songInfo.author,
        id: songId,
        audio_url: `https://cdn1.suno.ai/${songId}.mp3`,
      } as AudioInfo];
    } catch (e) {
      const songInfo = await this.getMetadataFromHTML(songId);
      tracks = [{
        title: songInfo.title,
        duration: '120',
        image_url: songInfo.image,
        created_at: '2021-10-10T00:00:00Z',
        model_name: songInfo.author,
        id: songId,
        audio_url: `https://cdn1.suno.ai/${songId}.mp3`,
      } as AudioInfo];
    }

    console.log(tracks);
    // @ts-ignore
    return this.sunoToYouTube(tracks);
  }

  async httpLiveStream(url: string): Promise<SongMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg(url).ffprobe((err, _) => {
        if (err) {
          reject();
        }

        resolve({
          url,
          source: MediaSource.HLS,
          isLive: true,
          title: url,
          artist: url,
          length: 0,
          offset: 0,
          playlist: null,
          thumbnailUrl: null,
        });
      });
    });
  }

  private async spotifyToYouTube(tracks: SpotifyTrack[], shouldSplitChapters: boolean, playlist?: QueuedPlaylist | undefined): Promise<[SongMetadata[], number, number]> {
    const promisedResults = tracks.map(async track => this.youtubeAPI.search(`"${track.name}" "${track.artist}"`, shouldSplitChapters));
    const searchResults = await Promise.allSettled(promisedResults);

    let nSongsNotFound = 0;

    // Count songs that couldn't be found
    const songs: SongMetadata[] = searchResults.reduce((accum: SongMetadata[], result) => {
      if (result.status === 'fulfilled') {
        for (const v of result.value) {
          accum.push({
            ...v,
            ...(playlist ? {playlist} : {}),
          });
        }
      } else {
        nSongsNotFound++;
      }

      return accum;
    }, []);

    return [songs, nSongsNotFound, tracks.length];
  }

  private async sunoToYouTube(tracks: AudioInfo[]): Promise<SongMetadata[]> {
    // Count songs that couldn't be found
    const track = tracks[0];
    return [
      {
        url: track.audio_url!,
        artist: track.model_name,
        isLive: false,
        playlist: null,
        source: MediaSource.HLS,
        thumbnailUrl: track.image_url!,
        // eslint-disable-next-line radix
        length: parseInt(track.duration ?? '0'),
        offset: 0,
        title: track.title!,
      },
    ];
  }

  private async getMetadataFromHTML(songId: string) {
    const html = await fetch(`https://suno.com/song/${songId}`).then(res => res.text())
    const $ = cheerio.load(html)
    const titleRaw = $('title').text()

    const title = titleRaw.split('by')[0].trim()
    const author = titleRaw.split('by')[1].replace(' | Suno', '').trim()
    const image = $('meta[property="og:image"]').attr('content')

    return {
      title,
      author,
      image
    }
  }
}
