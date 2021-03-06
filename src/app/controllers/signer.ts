import {PostsDAOImpl} from '../../../external/nomad-api/src/services/indexer/PostsDAO';
import {ModerationsDAOImpl} from '../../../external/nomad-api/src/services/indexer/ModerationsDAO';
import {ConnectionsDAOImpl} from '../../../external/nomad-api/src/services/indexer/ConnectionsDAO';
import {SqliteEngine} from '../../../external/nomad-api/src/services/indexer/Engine';
import SECP256k1Signer from 'fn-client/lib/crypto/signer'
import {Envelope as DomainEnvelope} from 'fn-client/lib/application/Envelope';
import {Post as DomainPost} from 'fn-client/lib/application/Post';
import {Connection as DomainConnection} from 'fn-client/lib/application/Connection';
import {Moderation as DomainModeration} from 'fn-client/lib/application/Moderation';

import electron from 'electron';
import * as path from 'path';
import fs from 'fs';
import {resourcesPath} from '../util/paths';
import logger from "../util/logger";
import UsersManager from "./users";
import FNDController, {fndVersionPath} from "./fnd";
import {isTLD, parseUsername} from "../../ui/helpers/user";
import {IndexerManager} from "../../../external/nomad-api/src/services/indexer";
import {SubdomainManager} from "../../../external/nomad-api/src/services/subdomains";
import {Writer} from "../../../external/nomad-api/src/services/writer";
import UserDataManager from "./userData";

const NOT_INITIALIZED_ERROR = new Error('Indexer Manager is not initialized.');
const NO_CURRENT_USER = new Error('No Creator.');

const dbPath = path.join(electron.app.getPath('userData'), 'appData', 'nomad.db');
const namedbPath = path.join(electron.app.getPath('userData'), 'appData', 'names.db');
const indexerVersionPath = fndVersionPath;

export type TopicMeta = {
  postOrder: {
    name: string;
    guid: string;
    hash: string;
  }[];
  posts: number;
  comments: number;
}

export type GlobalMeta = {
  topics: {
    [topicName: string]: TopicMeta;
  };
  users: {
    [username: string]: {
      posts: number;
      comments: number;
      profilePictureUrl?: string;
      lastProfilePictureUpdate?: number;
      coverImageUrl?: string;
      lastCoverImageUpdate?: number;
      firstActivity: number;
      lastActivity: number;
      topics: {
        [topic: string]: number;
      };
    };
  };
  lastScanned: number;
}

export default class SignerManager {
  pkHex: string;
  postsDao?: PostsDAOImpl;
  moderationsDao?: ModerationsDAOImpl;
  connectionsDao?: ConnectionsDAOImpl;
  writer?: Writer;
  subdomains?: SubdomainManager;
  signer?: SECP256k1Signer;
  usersController: UsersManager;
  fndController: FNDController;
  indexerManager: IndexerManager;
  userDataManager: UserDataManager;

  constructor (opts: {
    usersController: UsersManager;
    fndController: FNDController;
    indexerManager: IndexerManager;
    userDataManager: UserDataManager;
  }) {
    this.pkHex = '';
    this.userDataManager = opts.userDataManager;
    this.usersController = opts.usersController;
    this.fndController = opts.fndController;
    this.indexerManager = opts.indexerManager;
  }

  async init () {
    logger.info('[indexer manager] Copying database');
    await this.copyDB();
    logger.info('[indexer manager] Copied database');

    const engine = new SqliteEngine(dbPath);
    await engine.open();
    this.postsDao = new PostsDAOImpl(engine);
    this.moderationsDao = new ModerationsDAOImpl(engine);
    this.connectionsDao = new ConnectionsDAOImpl(engine);
    this.setIngestor('');
    const subdomains = new SubdomainManager({
      indexer: this.indexerManager,
    });
    const writer = new Writer({
      indexer: this.indexerManager,
      subdomains: subdomains,
    });
    subdomains.writer = writer;
    this.writer = writer;
    this.subdomains = subdomains;
  }

  private async shouldUpdateNomadDB (): Promise<boolean> {
    try {
      const resp = await fs.promises.readFile(indexerVersionPath);
      return resp.toString('utf-8') !== '0.0.55';
    } catch (e) {
      return true;
    }
  }

  private async copyDB () {
    const src = path.join(resourcesPath(), 'nomad.db');
    const nameSrc = path.join(resourcesPath(), 'names.db');
    if (!fs.existsSync(dbPath)) {
      await fs.promises.copyFile(src, dbPath);
    }

    if (!fs.existsSync(namedbPath)) {
      await fs.promises.copyFile(nameSrc, namedbPath);
    }
  }

  private async setIngestor (pkhex: string) {
    if (!this.postsDao || !this.moderationsDao || !this.connectionsDao) return;
    this.signer = SECP256k1Signer.fromHexPrivateKey(pkhex || '0000000000000000000000000000000000000000000000000000000000000000');
  }

  addSignerByHexPrivateKey (pk: string) {
    return this.setIngestor(pk);
  }

  private async appendTLDMessage(tld: string, message: DomainEnvelope<DomainPost|DomainModeration|DomainConnection>, truncate: boolean): Promise<DomainEnvelope<DomainPost|DomainModeration|DomainConnection>> {
    if (!this.signer) {
      return Promise.reject(new Error('User is not logged in.'));
    }

    const wire = message.toWire(0);
    const { offset } = await this.userDataManager.getUserData();

    const nextOffset = await this.writer?.appendEnvelope(
      tld,
      wire,
      undefined,
      false,
      offset,
      this.signer,
    );

    if (typeof nextOffset === "number") {
      await this.userDataManager.setOffset(nextOffset);
    }

    return message;
  }

  async sendNewPost (username: string, envelope: DomainEnvelope<DomainPost|DomainModeration|DomainConnection>, truncate: boolean): Promise<any> {
    if (!username) {
      return Promise.reject(NO_CURRENT_USER);
    }

    if (!this.postsDao || !this.moderationsDao) {
      return Promise.reject(NOT_INITIALIZED_ERROR);
    }

    const { tld } = parseUsername(username);

    if (isTLD(username)) {
      if (truncate) {
        await this.writer!.truncateBlob(tld, new Date(), false, this.signer);
      }

      const res = await this.appendTLDMessage(tld, envelope, truncate);
      const env = envelope.toWire(0);
      await this.indexerManager.insertPost(tld, env, [{ name: '', tld, public_key: '' }]);
      return res;
    }

    return Promise.reject(new Error('doesn\'t support subdomains'));
  }
}

function wait(ms= 0): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}
