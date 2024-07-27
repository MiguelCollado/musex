import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import {TYPES} from '../types.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('play-suno')
    .setDescription('play a song from suno.com')
    .addStringOption(option => option
      .setName('url')
      .setDescription('Suno URL of the song')
      .setAutocomplete(true)
      .setRequired(true))
    .addBooleanOption(option => option
      .setName('immediate')
      .setDescription('add track to the front of the queue'))
    .addBooleanOption(option => option
      .setName('shuffle')
      .setDescription('shuffle the input if you\'re adding multiple tracks'))
    .addBooleanOption(option => option
      .setName('split')
      .setDescription('if a track has chapters, split it'))
    .addBooleanOption(option => option
      .setName('skip')
      .setDescription('skip the currently playing track'));

  public requiresVC = true;

  private readonly addQueryToQueue: AddQueryToQueue;

  constructor(@inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue) {
    this.addQueryToQueue = addQueryToQueue;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const url = interaction.options.getString('url')!;

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: url.trim(),
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }
}
