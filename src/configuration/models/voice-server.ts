import { MongooseDocument } from '@/utils/mongoose-document';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Equals } from 'class-validator';
import { ConfigurationEntryKey } from './configuration-entry-key';

export enum SelectedVoiceServer {
  none = 'none',
  mumble = 'mumble',
}

@Schema()
export class MumbleOptions {
  @Prop()
  url: string;

  @Prop()
  port: number;

  @Prop()
  password?: string;

  @Prop()
  channelName?: string;
}

const mumbleOptionsSchema = SchemaFactory.createForClass(MumbleOptions);

@Schema()
export class VoiceServer extends MongooseDocument {
  constructor() {
    super();
    this.key = ConfigurationEntryKey.voiceServer;
    this.type = SelectedVoiceServer.none;
  }

  @Equals(ConfigurationEntryKey.voiceServer)
  key: ConfigurationEntryKey.voiceServer;

  @Prop({
    enum: SelectedVoiceServer,
    required: true,
  })
  type: SelectedVoiceServer;

  @Prop({ type: mumbleOptionsSchema, _id: false })
  mumble?: MumbleOptions;
}

export const voiceServerSchema = SchemaFactory.createForClass(VoiceServer);