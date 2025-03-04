const { Client } = require('discord.js')
const fs = require('fs')
const { S2 } = require('s2-geometry')
const mustache = require('handlebars')
const hastebin = require('hastebin-gen')
const { diff } = require('deep-object-diff')

const emojiStrip = require('../../../util/emojiStrip')

class DiscordCommando {
	constructor(token, query, scannerQuery, config, logs, GameData, PoracleInfo, dts, geofence, translatorFactory) {
		this.token = token
		this.config = config
		this.query = query
		this.scannerQuery = scannerQuery
		this.logs = logs
		this.GameData = GameData
		this.PoracleInfo = PoracleInfo
		this.updatedDiff = diff
		this.dts = dts
		this.geofence = geofence
		this.translatorFactory = translatorFactory
		this.translator = translatorFactory.default
		this.re = require('../../../util/regex')(this.translatorFactory)
		this.id = '0'
		this.bounceWorker()
	}

	async bounceWorker() {
		delete this.client
		// This will be required in discord.js 13
		// -- but causes an exception if intent not given in discord bot configuration
		// const intents = new Intents([
		// 	Intents.NON_PRIVILEGED, // include all non-privileged intents, would be better to specify which ones you actually need
		// 	'GUILD_MEMBERS', // lets you request guild members (i.e. fixes the issue)
		// ])

		this.client = new Client({
			messageCacheMaxSize: 1,
			messsageCacheLifetime: 60,
			messageSweepInterval: 120,
			messageEditHistoryMaxSize: 1,
			// ws: { intents },
		})
		try {
			this.client.on('error', (err) => {
				this.busy = true
				this.logs.log.error(`Discord worker #${this.id} \n bouncing`, err)
				this.bounceWorker()
			})
			this.client.on('rateLimit', (info) => {
				let channelId
				if (info.route) {
					const channelMatch = info.route.match(/\/channels\/(\d+)\//)
					if (channelMatch && channelMatch[1]) {
						const channel = this.client.channels.cache.get(channelMatch[1])
						if (channel) {
							channelId = channel.recipient && `DM:${channel.recipient.id}:${channel.recipient.username}`
								|| `${channel.id}:#${channel.name}`
						}
					}
				}
				this.logs.log.warn(`#${this.id} Discord commando worker - 429 rate limit hit - in timeout ${info.timeout ? info.timeout : 'Unknown timeout '} route ${info.route}${channelId ? ` (probably ${channelId})` : ''}`)
			})
			this.client.on('ready', () => {
				this.logs.log.info(`#${this.id} Discord commando - ${this.client.user.tag} ready for action`)

				this.busy = false
			})

			// We also need to make sure we're attaching the config to the CLIENT so it's accessible everywhere!
			this.client.config = this.config
			this.client.S2 = S2
			this.client.query = this.query
			this.client.scannerQuery = this.scannerQuery
			this.client.emojiStrip = emojiStrip
			this.client.logs = this.logs
			this.client.dts = this.dts
			this.client.re = this.re
			this.client.geofence = this.geofence
			this.client.GameData = this.GameData
			this.client.PoracleInfo = this.PoracleInfo
			this.client.mustache = mustache
			this.client.hastebin = hastebin
			this.client.translatorFactory = this.translatorFactory
			this.client.updatedDiff = diff
			this.client.translator = this.translator
			this.client.hookRegex = new RegExp('(?:(?:https?):\\/\\/|www\\.)(?:\\([-A-Z0-9+&@#\\/%=~_|$?!:,.]*\\)|[-A-Z0-9+&@#\\/%=~_|$?!:,.])*(?:\\([-A-Z0-9+&@#\\/%=~_|$?!:,.]*\\)|[-A-Z0-9+&@#\\/%=~_|$])', 'igm')

			fs.readdir(`${__dirname}/events/`, (err, files) => {
				if (err) return this.log.error(err)
				files.forEach((file) => {
					const event = require(`${__dirname}/events/${file}`) // eslint-disable-line global-require
					const eventName = file.split('.')[0]
					this.client.on(eventName, event.bind(null, this.client))
				})
			})

			this.client.commands = {}
			const enabledCommands = []
			fs.readdir(`${__dirname}/commands/`, (err, files) => {
				if (err) return this.log.error(err)
				files.forEach((file) => {
					if (!file.endsWith('.js')) return
					const props = require(`${__dirname}/commands/${file}`) // eslint-disable-line global-require
					const commandName = file.split('.')[0]
					enabledCommands.push(`${this.config.discord.prefix}${commandName}`)
					this.client.commands[commandName] = props
				})

				if (this.client.config.general.availableLanguages && !this.client.config.general.disabledCommands.includes('poracle')) {
					for (const [, availableLanguage] of Object.entries(this.client.config.general.availableLanguages)) {
						const commandName = availableLanguage.poracle
						if (commandName && !enabledCommands.includes(`${this.config.discord.prefix}${commandName}`)) {
							const props = require(`${__dirname}/commands/poracle`)
							enabledCommands.push(`${this.config.discord.prefix}${commandName}`)
							this.client.commands[commandName] = props
						}
					}
				}

				this.logs.log.info(`Discord commando loaded ${enabledCommands.join(', ')} commands`)
			})

			this.client.login(this.token)
		} catch (err) {
			this.logs.log.error(`Discord commando didn't bounce, \n ${err.message} \n trying again`)
			await this.sleep(2000)
			return this.bounceWorker()
		}
	}

	// eslint-disable-next-line class-methods-use-this
	async sleep(n) { return new Promise((resolve) => setTimeout(resolve, n)) }
}

module.exports = DiscordCommando
