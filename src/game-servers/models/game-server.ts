import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Exclude, Expose, Transform } from 'class-transformer';
import { Rcon } from 'rcon-client/lib';
import { NotImplementedError } from '../errors/not-implemented.error';
import { TransformObjectId } from '@/shared/decorators/transform-object-id';
import { Serializable } from '@/shared/serializable';
import { GameServerDto } from '../dto/game-server.dto';

@Schema({ discriminatorKey: 'provider' })
export class GameServer extends Serializable<GameServerDto> {
  provider: string;

  @Exclude({ toPlainOnly: true })
  __v?: number;

  @Exclude({ toPlainOnly: true })
  @TransformObjectId()
  _id?: Types.ObjectId;

  @Expose()
  @Transform(({ value, obj }) => value ?? obj._id?.toString())
  id!: string;

  @Prop({ default: () => new Date() })
  createdAt!: Date;

  @Prop({ required: true, trim: true })
  name: string;

  /**
   * The gameserver's public IP address.
   */
  @Prop({ required: true, trim: true })
  address: string;

  @Prop({ required: true })
  port: string;

  @TransformObjectId()
  @Prop({ type: Types.ObjectId, ref: 'Game' })
  game?: Types.ObjectId; // currently running game

  /**
   * Create a new RCON connection to the gameserver.
   */
  async rcon(): Promise<Rcon> {
    throw new NotImplementedError();
  }

  /**
   * Obtain a logsecret that is configured for this gameserver.
   */
  async getLogsecret(): Promise<string> {
    throw new NotImplementedError();
  }

  /**
   * Start the gameserver (in case it needs to be started).
   */
  async start(): Promise<this> {
    return Promise.resolve(this);
  }

  async serialize(): Promise<GameServerDto> {
    return {
      id: this.id,
      createdAt: this.createdAt,
      name: this.name,
      address: this.address,
      port: this.port,
    };
  }
}

export type GameServerDocument = GameServer & Document;
export const gameServerSchema = SchemaFactory.createForClass(GameServer);
