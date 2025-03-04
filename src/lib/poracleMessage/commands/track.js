const helpCommand = require('./help')
const trackedCommand = require('./tracked')

exports.run = async (client, msg, args, options) => {
	const logReference = Math.random().toString().slice(2, 11)

	try {
		const util = client.createUtil(msg, options)

		const {
			canContinue, target, userHasLocation, userHasArea, language, currentProfileNo,
		} = await util.buildTarget(args)

		if (!canContinue) return
		const commandName = __filename.slice(__dirname.length + 1, -3)

		client.log.info(`${logReference} ${target.name}/${target.type}-${target.id}: ${commandName} ${args}`)

		if (args[0] === 'help') {
			return helpCommand.run(client, msg, [commandName], options)
		}

		const translator = client.translatorFactory.Translator(language)

		if (!await util.commandAllowed('monster')) {
			await msg.react('🚫')
			return msg.reply(translator.translate('You do not have permission to execute this command'))
		}

		if (args.length === 0) {
			await msg.reply(translator.translateFormat('Valid commands are e.g. `{0}track charmander`, `{0}track everything iv100`, `{0}track gible d500`', util.prefix),
				{ style: 'markdown' })
			await helpCommand.provideSingleLineHelp(client, msg, util, language, target, commandName)
			return
		}

		// Check for basic 'everything' tracking with no other parameters
		if (args.length === 1 && args[0] === 'everything' && !msg.isFromAdmin) {
			await msg.reply(translator.translate('This would result in too many alerts. You need to provide additional filters to limit the number of valid candidates.'))
			await helpCommand.provideSingleLineHelp(client, msg, util, language, target, commandName)
			return
		}

		const typeArray = Object.keys(client.GameData.utilData.types).map((o) => o.toLowerCase())

		let reaction = '👌'
		const pvpFilterMaxRank = Math.min(client.config.pvp.pvpFilterMaxRank, 4096)
		const leagueMinCp = {
			little: client.config.pvp.pvpFilterLittleMinCP,
			great: client.config.pvp.pvpFilterGreatMinCP,
			ultra: client.config.pvp.pvpFilterUltraMinCP,
		}

		let monsters

		let disableEverythingTracking
		let forceEverythingSeparately
		let individuallyAllowed
		switch (client.config.tracking.everythingFlagPermissions.toLowerCase()) {
			case 'allow-any': {
				disableEverythingTracking = false
				forceEverythingSeparately = false
				individuallyAllowed	= true
				break
			}
			case 'allow-and-always-individually': {
				disableEverythingTracking = false
				forceEverythingSeparately = true
				individuallyAllowed	= true
				break
			}
			case 'allow-and-ignore-individually': {
				disableEverythingTracking = false
				forceEverythingSeparately = false
				individuallyAllowed	= false
				break
			}
			case 'deny':
			default: {
				disableEverythingTracking = true
				forceEverythingSeparately = false
				individuallyAllowed	= true
			}
		}
		const littleLeagueAllowed = client.config.pvp.dataSource === 'internal' || client.config.pvp.dataSource === 'chuck'

		// Remove arguments that we don't want to keep for processing
		for (let i = args.length - 1; i >= 0; i--) {
			if (args[i].match(client.re.nameRe)
				|| args[i].match(client.re.channelRe)
				|| args[i].match(client.re.userRe)) {
				args.splice(i, 1)
			}
		}
		// Substitute aliases
		const pokemonAlias = require('../../../../config/pokemonAlias.json')
		for (let i = args.length - 1; i >= 0; i--) {
			let alias = pokemonAlias[args[i]]
			if (alias) {
				if (!Array.isArray(alias)) alias = [alias]
				args.splice(i, 1, ...alias.map((x) => x.toString()))
			}
		}

		const parameterDefinition = {
			d: client.re.dRe,
			t: client.re.tRe,
			form: client.re.formRe,
			template: client.re.templateRe,
			gen: client.re.genRe,
			iv: client.re.ivRe,
			maxiv: client.re.maxivRe,
			level: client.re.levelRe,
			maxlevel: client.re.maxlevelRe,
			cp: client.re.cpRe,
			maxcp: client.re.maxcpRe,
			weight: client.re.weightRe,
			maxweight: client.re.maxweightRe,
			rarity: client.re.rarityRe,
			maxrarity: client.re.maxRarityRe,
			maxatk: client.re.maxatkRe,
			maxdef: client.re.maxdefRe,
			maxsta: client.re.maxstaRe,
			atk: client.re.atkRe,
			def: client.re.defRe,
			sta: client.re.staRe,
			male: '^male$',
			female: '^female$',
			genderless: '^genderless$',
			clean: '^clean$',
			ping: '^<@.*',				// will not be used but stops it being listed as invalid parameter
		}

		if (!disableEverythingTracking || msg.isFromAdmin) parameterDefinition.everything = '^everything$'
		if (individuallyAllowed || msg.isFromAdmin) parameterDefinition.individually = '^individually$'

		const leagues = {
			great: 1500,
			ultra: 2500,
		}
		if (littleLeagueAllowed) leagues.little = 500

		const parameterPermissionsLink = {
			pvp: [],
		}

		Object.keys(leagues).forEach((league) => {
			parameterDefinition[league] = client.re[`${league}LeagueRe`]
			parameterDefinition[`${league}cp`] = client.re[`${league}LeagueCPRe`]
			parameterDefinition[`${league}high`] = client.re[`${league}LeagueHighestRe`]
			parameterPermissionsLink.pvp.push(...[league, `${league}cp`, `${league}high`])
		})

		const parameterValues = {

		}

		let monsterList = new Set()
		const typeList = []
		const formNames = []

		// Parse command elements to stuff
		for (const element of args) {
			const matches = Object.entries(parameterDefinition).filter(([, re]) => element.match(re)).map(([name]) => name)

			if (matches.length) {
				const paramName = matches[0]
				const permissionName = Object.entries(parameterPermissionsLink).filter(([, commands]) => commands.includes(paramName)).map(([perm]) => perm)

				if (permissionName.length && !await util.commandAllowed(permissionName[0])) {
					await msg.react('🚫')
					return msg.reply(translator.translateFormat('You do not have permission to use the `{0}` parameter',
						translator.translate(paramName)))
				}

				switch (paramName) {
					case 'male': parameterValues.gender = 1; break
					case 'female': parameterValues.gender = 2; break
					case 'genderless': parameterValues.gender = 3; break
					case 'form': {
						const matchResult = element.match(parameterDefinition[paramName])[2]
						const formName = client.translatorFactory.reverseTranslateCommand(matchResult, true).toLowerCase()
						if (Object.values(client.GameData.monsters).some((mon) => mon.form.name.toLowerCase() === formName)) {
							formNames.push(formName)
						} else {
							await msg.react('🙅')
							return msg.reply(translator.translateFormat('Unrecognised form name {0}', formName))
						}
						break
					}
					default: {
						const matchResult = element.match(parameterDefinition[paramName])
						if (matchResult.length === 1) parameterValues[paramName] = true
						else [, , parameterValues[paramName]] = matchResult
					}
				}
			} else {
				const monster = Object.values(client.GameData.monsters).find((mon) => (element === mon.name.toLowerCase()) || element === mon.id.toString())
				if (monster) monsterList.add(monster.id)
				else if (typeArray.includes(element)) typeList.push(element)
				else {
					await msg.react('🙅')
					return msg.reply(translator.translateFormat('I do not understand this option: {0}', element))
				}
			}
		}

		if (parameterValues.everything) {
			if (parameterValues.individually || parameterValues.gen || formNames.length || typeList.length || forceEverythingSeparately) {
				monsterList = new Set(Object.values(client.GameData.monsters).filter((mon) => !mon.form.id).map((mon) => mon.id))
			} else {
				monsterList = new Set([0])
			}
		}

		if (parameterValues.gen) {
			const gen = client.GameData.utilData.genData[+parameterValues.gen]
			if (monsterList.size) {
				monsterList = new Set([...monsterList].filter((id) => id >= gen.min && id <= gen.max))
			} else {
				monsterList = new Set(Object.values(client.GameData.monsters).filter((mon) => !mon.form.id && mon.id >= gen.min && mon.id <= gen.max).map((mon) => mon.id))
			}
		}

		if (typeList.length) {
			const validMonsters = Object.values(client.GameData.monsters).filter((mon) => mon.types.map((t) => t.name.toLowerCase()).some((t) => typeList.includes(t)))
			if (monsterList.size) {
				monsterList = new Set([...monsterList].filter((id) => validMonsters.some((mon) => mon.id === id)))
			} else {
				monsterList = new Set(validMonsters.filter((mon) => !mon.form.id).map((mon) => mon.id))
			}
		}

		const monsterArray = [...monsterList]

		if (formNames.length) {
			monsters = Object.values(client.GameData.monsters).filter((mon) => formNames.includes(mon.form.name.toLowerCase()) && monsterArray.includes(mon.id))
		} else if (monsterArray.includes(0)) {
			monsters = [{ id: 0, form: { id: 0 } }]
		} else {
			monsters = monsterArray.map((id) => ({ id, form: { id: 0 } }))
		}

		const defaultTo = ((value, x) => ((value === undefined) ? x : value))
		// Set defaults

		let distance = +defaultTo(parameterValues.d, 0)
		let rarity = defaultTo(parameterValues.rarity, -1)
		let maxRarity = defaultTo(parameterValues.maxrarity, 6)
		const pings = msg.getPings()

		const pvp = {}

		Object.entries(leagues).forEach(([league, rank]) => {
			const leagueLowest = +defaultTo(parameterValues[league], 4096)
			const leagueHighest = +defaultTo(parameterValues[`${league}high`], 1)
			const leagueCP = +defaultTo(parameterValues[`${league}cp`], 0)

			if (leagueLowest < 4096 || leagueCP > 0) {
				pvp[rank] = {
					minCp: Math.max(leagueCP, leagueMinCp[league]),
					worst: Math.min(leagueLowest, pvpFilterMaxRank),
					best: leagueHighest,
				}
			}
		})

		if (Object.keys(pvp).length > 1) {
			await msg.react(translator.translate('🙅'))
			return await msg.reply(`${translator.translate('Oops, more than one league PVP parameters were set in command! - check the')} \`${util.prefix}${translator.translate('help')}\``)
		}

		if (!msg.isFromAdmin) {
			distance = distance || client.config.tracking.defaultDistance || 0
			distance = Math.min(distance, client.config.tracking.maxDistance || 40000000) // circumference of Earth
		}

		if (rarity !== -1 && !['1', '2', '3', '4', '5', '6'].includes(rarity)) {
			rarity = client.translatorFactory.reverseTranslateCommand(rarity, true)
			const rarityLevel = Object.keys(client.GameData.utilData.rarity).find((x) => client.GameData.utilData.rarity[x].toLowerCase() === rarity.toLowerCase())
			if (rarityLevel) {
				rarity = rarityLevel
			} else {
				rarity = -1
			}
		}
		if (maxRarity !== 6 && !['1', '2', '3', '4', '5', '6'].includes(maxRarity)) {
			maxRarity = client.translatorFactory.reverseTranslateCommand(maxRarity, true)
			const maxRarityLevel = Object.keys(client.GameData.utilData.rarity).find((x) => client.GameData.utilData.rarity[x].toLowerCase() === maxRarity.toLowerCase())
			if (maxRarityLevel) {
				maxRarity = maxRarityLevel
			} else {
				maxRarity = 6
			}
		}

		if (distance > 0 && !userHasLocation && !target.webhook) {
			await msg.react(translator.translate('🙅'))
			return await msg.reply(`${translator.translate('Oops, a distance was set in command but no location is defined for your tracking - check the')} \`${util.prefix}${translator.translate('help')}\``)
		}
		if (distance === 0 && !userHasArea && !target.webhook && !msg.isFromAdmin) {
			await msg.react(translator.translate('🙅'))
			return await msg.reply(`${translator.translate('Oops, no distance was set in command and no area is defined for your tracking - check the')} \`${util.prefix}${translator.translate('help')}\``)
		}
		if (distance === 0 && !userHasArea && !target.webhook && msg.isFromAdmin) {
			await msg.reply(`${translator.translate('Warning: Admin command detected without distance set - using default distance')} ${client.config.tracking.defaultDistance}`)
			distance = client.config.tracking.defaultDistance
		}

		const pvpLeague = Object.keys(pvp)[0] || 0

		const insert = monsters.map((mon) => ({
			id: target.id,
			profile_no: currentProfileNo,
			pokemon_id: mon.id,
			ping: pings,
			distance: +distance,
			min_iv: +defaultTo(parameterValues.iv, -1),
			max_iv: +defaultTo(parameterValues.maxiv, 100),
			min_cp: +defaultTo(parameterValues.cp, 0),
			max_cp: +defaultTo(parameterValues.maxcp, 9000),
			min_level: +defaultTo(parameterValues.level, 0),
			max_level: +defaultTo(parameterValues.maxlevel, 40),
			atk: +defaultTo(parameterValues.atk, 0),
			def: +defaultTo(parameterValues.def, 0),
			sta: +defaultTo(parameterValues.sta, 0),
			template: defaultTo(parameterValues.template, client.config.general.defaultTemplateName).toString(),
			min_weight: +defaultTo(parameterValues.weight, 0),
			max_weight: +defaultTo(parameterValues.maxweight, 9000000),
			form: mon.form.id,
			max_atk: +defaultTo(parameterValues.maxatk, 15),
			max_def: +defaultTo(parameterValues.maxdef, 15),
			max_sta: +defaultTo(parameterValues.maxsta, 15),
			gender: +defaultTo(parameterValues.gender, 0),
			clean: +defaultTo(parameterValues.clean, 0),
			pvp_ranking_league: +pvpLeague,
			pvp_ranking_best: pvpLeague ? +pvp[pvpLeague].best : 1,
			pvp_ranking_worst: pvpLeague ? +pvp[pvpLeague].worst : 4096,
			pvp_ranking_min_cp: pvpLeague ? +pvp[pvpLeague].minCp : 0,
			rarity: +rarity,
			max_rarity: +maxRarity,
			min_time: +defaultTo(parameterValues.t, 0),
		}))
		if (!insert.length) {
			return await msg.reply(translator.translate('404 No monsters found'))
		}

		const tracked = await client.query.selectAllQuery('monsters', { id: target.id, profile_no: currentProfileNo })
		const updates = []
		const alreadyPresent = []

		for (let i = insert.length - 1; i >= 0; i--) {
			const toInsert = insert[i]

			for (const existing of tracked.filter((x) => x.pokemon_id === toInsert.pokemon_id)) {
				const differences = client.updatedDiff(existing, toInsert)

				switch (Object.keys(differences).length) {
					case 1:		// No differences (only UID)
						// No need to insert
						alreadyPresent.push(toInsert)
						insert.splice(i, 1)
						break
					case 2:		// One difference (something + uid)
						if (Object.keys(differences).some((x) => ['min_iv', 'distance', 'template', 'clean'].includes(x))) {
							updates.push({
								...toInsert,
								uid: existing.uid,
							})
							insert.splice(i, 1)
						}
						break
					default:	// more differences
						break
				}
			}
		}

		let message = ''

		if ((alreadyPresent.length + updates.length + insert.length) > 50) {
			message = translator.translateFormat('I have made a lot of changes. See {0}{1} for details', util.prefix, translator.translate('tracked'))
		} else {
			alreadyPresent.forEach((monster) => {
				message = message.concat(translator.translate('Unchanged: '), trackedCommand.monsterRowText(client.config, translator, client.GameData, monster), '\n')
			})
			updates.forEach((monster) => {
				message = message.concat(translator.translate('Updated: '), trackedCommand.monsterRowText(client.config, translator, client.GameData, monster), '\n')
			})
			insert.forEach((monster) => {
				message = message.concat(translator.translate('New: '), trackedCommand.monsterRowText(client.config, translator, client.GameData, monster), '\n')
			})
		}

		await client.query.deleteWhereInQuery('monsters', {
			id: target.id,
			profile_no: currentProfileNo,
		},
		updates.map((x) => x.uid),
		'uid')

		await client.query.insertQuery('monsters', [...insert, ...updates])

		reaction = insert.length ? '✅' : reaction
		await msg.reply(message, { style: 'markdown' })
		await msg.react(reaction)

		client.log.info(`${logReference} ${target.name} started tracking monsters: ${monsters.map((m) => m.name).join(', ')}`)
	} catch (err) {
		client.log.error(`${logReference} Track command unhappy:`, err)
		msg.reply(`There was a problem making these changes, the administrator can find the details with reference ${logReference}`)
	}
}
