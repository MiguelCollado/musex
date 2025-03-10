/* eslint-disable */

import axios, {AxiosInstance} from 'axios';
// @ts-expect-error
import UserAgent from 'user-agents';
import pino from 'pino';
import {wrapper} from 'axios-cookiejar-support';
import {CookieJar} from 'tough-cookie';
import {sleep} from '../utils/axios.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import ThirdParty from './third-party.js';

const logger = pino();
export const DEFAULT_MODEL = 'chirp-v3-5';

export interface AudioInfo {
  id: string; // Unique identifier for the audio
  title?: string; // Title of the audio
  image_url?: string; // URL of the image associated with the audio
  lyric?: string; // Lyrics of the audio
  audio_url?: string; // URL of the audio file
  video_url?: string; // URL of the video associated with the audio
  created_at: string; // Date and time when the audio was created
  model_name: string; // Name of the model used for audio generation
  gpt_description_prompt?: string; // Prompt for GPT description
  prompt?: string; // Prompt for audio generation
  status: string; // Status
  type?: string;
  tags?: string; // Genre of music.
  duration?: string; // Duration of the audio
  error_message?: string; // Error message if any
}

@injectable()
export class SunoAPI {
  private readonly suno: Suno;

  constructor(@inject(TYPES.ThirdParty) thirdParty: ThirdParty) {
    this.suno = thirdParty.suno;
  }

  public async get(songIds?: string[]): Promise<AudioInfo[] | {detail: string}[] > {
    return this.suno.get(songIds);
  }
}

export class Suno {
  private static get BASE_URL() {
    return 'https://studio-api.suno.ai';
  }

  private static get CLERK_BASE_URL() {
    return 'https://clerk.suno.com';
  }

  private readonly client: AxiosInstance;
  private sid?: string;
  private currentToken?: string;

  constructor(cookie: string) {
    const cookieJar = new CookieJar();
    const randomUserAgent = new UserAgent(/Chrome/).random().toString();
    this.client = wrapper(axios.create({
      jar: cookieJar,
      withCredentials: true,
      headers: {
        'User-Agent': randomUserAgent,
        Cookie: cookie,
      },
    }));
    this.client.interceptors.request.use(config => {
      if (this.currentToken) { // Use the current token status
        config.headers.Authorization = `Bearer ${this.currentToken}`;
      }

      return config;
    });
  }

  public async init(): Promise<Suno> {
    await this.getAuthToken();
    await this.keepAlive();
    return this;
  }

  /**
   * Get the session ID and save it for later use.
   */
  private async getAuthToken() {
    // URL to get session ID
    const getSessionUrl = `${Suno.CLERK_BASE_URL}/v1/client?_clerk_js_version=4.73.3`;
    // Get session ID
    const sessionResponse = await this.client.get(getSessionUrl);
    if (!sessionResponse?.data?.response?.last_active_session_id) {
      throw new Error('Failed to get session id, you may need to update the SUNO_COOKIE');
    }

    // Save session ID for later use
    this.sid = sessionResponse.data.response.last_active_session_id;
  }

  /**
   * Keep the session alive.
   * @param isWait Indicates if the method should wait for the session to be fully renewed before returning.
   */
  public async keepAlive(isWait?: boolean): Promise<void> {
    if (!this.sid) {
      throw new Error('Session ID is not set. Cannot renew token.');
    }

    // URL to renew session token
    const renewUrl = `${Suno.CLERK_BASE_URL}/v1/client/sessions/${this.sid}/tokens?_clerk_js_version==4.73.3`;
    // Renew session token
    const renewResponse = await this.client.post(renewUrl);
    logger.info('KeepAlive...\n');
    if (isWait) {
      await sleep(1, 2);
    }

    // Update Authorization field in request header with the new JWT token
    this.currentToken = renewResponse.data.jwt;
  }

  /**
   * Generate a song based on the prompt.
   * @param prompt The text prompt to generate audio from.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param model
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns
   */
  public async generate(
    prompt: string,
    make_instrumental = false,
    model?: string,
    wait_audio = false,

  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const startTime = Date.now();
    const audios = this.generateSongs(prompt, false, undefined, undefined, make_instrumental, model, wait_audio);
    const costTime = Date.now() - startTime;
    logger.info('Generate Response:\n' + JSON.stringify(audios, null, 2));
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Calls the concatenate endpoint for a clip to generate the whole song.
   * @param clip_id The ID of the audio clip to concatenate.
   * @returns A promise that resolves to an AudioInfo object representing the concatenated audio.
   * @throws Error if the response status is not 200.
   */
  public async concatenate(clip_id: string): Promise<AudioInfo> {
    await this.keepAlive(false);
    const payload: any = {clip_id};

    const response = await this.client.post(
      `${Suno.BASE_URL}/api/generate/concat/v2/`,
      payload,
      {
        timeout: 10000, // 10 seconds timeout
      },
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }

    return response.data;
  }

  /**
   * Generates custom audio based on provided parameters.
   *
   * @param prompt The text prompt to generate audio from.
   * @param tags Tags to categorize the generated audio.
   * @param title The title for the generated audio.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param model
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated audios.
   */
  public async custom_generate(
    prompt: string,
    tags: string,
    title: string,
    make_instrumental = false,
    model?: string,
    wait_audio = false,
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    const audios = await this.generateSongs(prompt, true, tags, title, make_instrumental, model, wait_audio);
    const costTime = Date.now() - startTime;
    logger.info('Custom Generate Response:\n' + JSON.stringify(audios, null, 2));
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Generates songs based on the provided parameters.
   *
   * @param prompt The text prompt to generate songs from.
   * @param isCustom Indicates if the generation should consider custom parameters like tags and title.
   * @param tags Optional tags to categorize the song, used only if isCustom is true.
   * @param title Optional title for the song, used only if isCustom is true.
   * @param make_instrumental Indicates if the generated song should be instrumental.
   * @param model
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated songs.
   */
  private async generateSongs(
    prompt: string,
    isCustom: boolean,
    tags?: string,
    title?: string,
    make_instrumental?: boolean,
    model?: string,
    wait_audio = false,
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const payload: any = {
      make_instrumental: make_instrumental == true,
      mv: model || DEFAULT_MODEL,
      prompt: '',
    };
    if (isCustom) {
      payload.tags = tags;
      payload.title = title;
      payload.prompt = prompt;
    } else {
      payload.gpt_description_prompt = prompt;
    }

    logger.info('generateSongs payload:\n' + JSON.stringify({
      prompt,
      isCustom,
      tags,
      title,
      make_instrumental,
      wait_audio,
      payload,
    }, null, 2));
    const response = await this.client.post(
      `${Suno.BASE_URL}/api/generate/v2/`,
      payload,
      {
        timeout: 10000, // 10 seconds timeout
      },
    );
    logger.info('generateSongs Response:\n' + JSON.stringify(response.data, null, 2));
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }

    const songIds = response.data.clips.map((audio: any) => audio.id);
    // Want to wait for music file generation
    if (wait_audio) {
      const startTime = Date.now();
      let lastResponse: AudioInfo[] = [];
      await sleep(5, 5);
      while (Date.now() - startTime < 100000) {
        const response = await this.get(songIds);
        const allCompleted = response.every(
          audio => audio.status === 'streaming' || audio.status === 'complete',
        );
        const allError = response.every(
          audio => audio.status === 'error',
        );
        if (allCompleted || allError) {
          return response;
        }

        lastResponse = response;
        await sleep(3, 6);
        await this.keepAlive(true);
      }

      return lastResponse;
    }

    await this.keepAlive(true);
    return response.data.clips.map((audio: any) => ({
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      lyric: audio.metadata.prompt,
      audio_url: audio.audio_url,
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata.gpt_description_prompt,
      prompt: audio.metadata.prompt,
      type: audio.metadata.type,
      tags: audio.metadata.tags,
      duration: audio.metadata.duration,
    }));
  }

  /**
   * Generates lyrics based on a given prompt.
   * @param prompt The prompt for generating lyrics.
   * @returns The generated lyrics text.
   */
  public async generateLyrics(prompt: string): Promise<string> {
    await this.keepAlive(false);
    // Initiate lyrics generation
    const generateResponse = await this.client.post(`${Suno.BASE_URL}/api/generate/lyrics/`, {prompt});
    const generateId = generateResponse.data.id;

    // Poll for lyrics completion
    let lyricsResponse = await this.client.get(`${Suno.BASE_URL}/api/generate/lyrics/${generateId}`);
    while (lyricsResponse?.data?.status !== 'complete') {
      await sleep(2); // Wait for 2 seconds before polling again
      lyricsResponse = await this.client.get(`${Suno.BASE_URL}/api/generate/lyrics/${generateId}`);
    }

    // Return the generated lyrics text
    return lyricsResponse.data;
  }

  /**
   * Extends an existing audio clip by generating additional content based on the provided prompt.
   *
   * @param audioId The ID of the audio clip to extend.
   * @param prompt The prompt for generating additional content.
   * @param continueAt Extend a new clip from a song at mm:ss(e.g. 00:30). Default extends from the end of the song.
   * @param tags Style of Music.
   * @param title Title of the song.
   * @param model
   * @returns A promise that resolves to an AudioInfo object representing the extended audio clip.
   */
  public async extendAudio(
    audioId: string,
    prompt = '',
    continueAt = '0',
    tags = '',
    title = '',
    model?: string,
  ): Promise<AudioInfo> {
    const response = await this.client.post(`${Suno.BASE_URL}/api/generate/v2/`, {
      continue_clip_id: audioId,
      continue_at: continueAt,
      mv: model || DEFAULT_MODEL,
      prompt,
      tags,
      title,
    });
    console.log('response：\n', response);
    return response.data;
  }

  /**
   * Processes the lyrics (prompt) from the audio metadata into a more readable format.
   * @param prompt The original lyrics text.
   * @returns The processed lyrics text.
   */
  private parseLyrics(prompt: string): string {
    // Assuming the original lyrics are separated by a specific delimiter (e.g., newline), we can convert it into a more readable format.
    // The implementation here can be adjusted according to the actual lyrics format.
    // For example, if the lyrics exist as continuous text, it might be necessary to split them based on specific markers (such as periods, commas, etc.).
    // The following implementation assumes that the lyrics are already separated by newlines.

    // Split the lyrics using newline and ensure to remove empty lines.
    const lines = prompt.split('\n').filter(line => line.trim() !== '');

    // Reassemble the processed lyrics lines into a single string, separated by newlines between each line.
    // Additional formatting logic can be added here, such as adding specific markers or handling special lines.
    return lines.join('\n');
  }

  /**
   * Retrieves audio information for the given song IDs.
   * @param songIds An optional array of song IDs to retrieve information for.
   * @returns A promise that resolves to an array of AudioInfo objects.
   */
  public async get(songIds?: string[]): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    let url = `${Suno.BASE_URL}/api/feed/`;
    if (songIds) {
      url = `${url}?ids=${songIds.join(',')}`;
    }

    logger.info('Get audio status: ' + url);
    const response = await this.client.get(url, {
      // 3 seconds timeout
      timeout: 3000,
    });

    const audios = response.data;
    return audios.map((audio: any) => ({
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      lyric: audio.metadata.prompt ? this.parseLyrics(audio.metadata.prompt) : '',
      audio_url: audio.audio_url,
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata.gpt_description_prompt,
      prompt: audio.metadata.prompt,
      type: audio.metadata.type,
      tags: audio.metadata.tags,
      duration: audio.metadata.duration,
      error_message: audio.metadata.error_message,
    }));
  }

  /**
   * Retrieves information for a specific audio clip.
   * @param clipId The ID of the audio clip to retrieve information for.
   * @returns A promise that resolves to an object containing the audio clip information.
   */
  public async getClip(clipId: string): Promise<Record<string, unknown>> {
    await this.keepAlive(false);
    const response = await this.client.get(`${Suno.BASE_URL}/api/clip/${clipId}`);
    return response.data;
  }

  public async get_credits(): Promise<Record<string, unknown>> {
    await this.keepAlive(false);
    const response = await this.client.get(`${Suno.BASE_URL}/api/billing/info/`);
    return {
      credits_left: response.data.total_credits_left,
      period: response.data.period,
      monthly_limit: response.data.monthly_limit,
      monthly_usage: response.data.monthly_usage,
    };
  }
}

export const newSunoApi = async (cookie: string) => {
  const sunoApi = new Suno(cookie);
  return sunoApi.init();
};

