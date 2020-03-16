import {Message} from 'discord.js';
import {TYPES} from '../types';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player';
import {STATUS} from '../services/player';
import Command from '.';

@injectable()
export default class implements Command {
  public name = 'pause';
  public description = 'pause currently playing song';
  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(msg: Message, _: string []): Promise<void> {
    const player = this.playerManager.get(msg.guild!.id);

    if (player.status !== STATUS.PLAYING) {
      await msg.channel.send('error: not currently playing');
      return;
    }

    player.pause();
    await msg.channel.send('paused');
  }
}