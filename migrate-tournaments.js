const Database = require("better-sqlite3");

// Create or open the SQLite database file
const db = new Database("database.db");
const slugify = require("slugify");

const { existsSync } = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { slugifyOptions, parsePacketMetadata, filterPaths, filterFiles, cleanName } = require("./utils");

require("dotenv").config();

const basePath = process.env.BASE_PATH || "./";
const tournamentsPath = path.join(basePath, "data/tournaments");
const gamesFolderName = "game_files";
const buzzesFileName = "buzzes.csv";
const bonusesFileName = "bonuses.csv";
const overWriteFlag = "--overwrite";
const overWrite = process.argv.find((a) => a === overWriteFlag);

const insertTournamentStatement = db.prepare(
  "INSERT INTO tournament (name, slug, question_set_edition_id, location, level, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const insertRoundStatement = db.prepare(
  "INSERT INTO round (tournament_id, number, packet_id, exclude_from_individual) VALUES (?, ?, ?, ?)"
);
const insertTeamStatement = db.prepare("INSERT INTO team (tournament_id, name, slug) VALUES (?, ?, ?)");
const insertPlayerStatement = db.prepare(
  "INSERT INTO player (team_id, name, slug, question_set_id) VALUES (?, ?, ?, ?)"
);
const insertGameStatement = db.prepare(
  "INSERT INTO game (round_id, tossups_read, team_one_id, team_two_id) VALUES (?, ?, ?, ?)"
);
const insertBuzzStatement = db.prepare(
  "INSERT INTO buzz (player_id, game_id, tossup_id, buzz_position, value) VALUES (?, ?, ?, ?, ?)"
);
const insertBonusPartDirectStatement = db.prepare(
  "INSERT INTO bonus_part_direct (team_id, game_id, bonus_part_id, value) VALUES (?, ?, ?, ?)"
);

const deleteTournamentStatement = db.prepare("DELETE FROM tournament WHERE id = ?");
const findTournamentStatement = db.prepare("SELECT id FROM tournament WHERE slug = ?");
const findQuestionSetEditionStatement = db.prepare(`
    SELECT  question_set.id as question_set_id,
            question_set_edition.id as question_set_edition_id
    FROM question_set
    JOIN question_set_edition ON question_set.id = question_set_id
    WHERE question_set.name = ? AND question_set_edition.name = ?
`);
const findPacketByNameStatement = db.prepare("SELECT id FROM packet WHERE question_set_edition_id = ? and name = ?");
const findPacketByIdStatement = db.prepare("SELECT * FROM packet WHERE question_set_edition_id = ? and id = ?");
const findTossupStatement = db.prepare(`
    SELECT tossup.id
    FROM packet_question
    JOIN question on packet_question.question_id = question.id
    JOIN tossup on question.id = tossup.question_id
    WHERE packet_id = ? AND question_number = ?
`);
const findBonusPartsStatement = db.prepare(`
    SELECT bonus_part.id, part_number
    FROM packet_question
    JOIN question on packet_question.question_id = question.id
    JOIN bonus on question.id = bonus.question_id
    JOIN bonus_part ON bonus.id = bonus_id
    WHERE packet_id = ? and question_number = ?
`);
const findPlayerBySetIdStatement = db.prepare(`
    SELECT *
    FROM player
    WHERE name = ? and question_set_id = ?
`);
const findTeamByIdStatement = db.prepare(`
    SELECT *
    FROM team
    WHERE id = ?
`);
const findGameByRoundAndTeamsStatement = db.prepare(`
    SELECT id
    FROM game
    WHERE round_id = ? and team_one_id = ? AND team_two_id = ?
`);

const migrateTournaments = async () => {
  try {
    const subFolders = filterPaths(await fs.readdir(tournamentsPath, { withFileTypes: true }));

    for (const subFolder of subFolders) {
      const subFolderPath = path.join(tournamentsPath, subFolder);
      const indexPath = path.join(subFolderPath, "index.json");

      if (!existsSync(indexPath)) {
        console.log(`Skipping ${subFolder} as 'index.json' file not found.`);
        continue;
      }

      try {
        const tournamentData = await fs.readFile(indexPath, "utf8");
        const tournament = JSON.parse(tournamentData);
        const gamesFilePath = path.join(subFolderPath, gamesFolderName);
        const {
          name: tournamentName,
          slug: tournamentSlug,
          set,
          edition,
          location,
          level,
          start_date,
          end_date,
          rounds_to_exclude_from_individual_stats,
          rounds,
        } = tournament;
        const { id: existingTournamentId } = findTournamentStatement.get(tournamentSlug) || {};

        if (existingTournamentId) {
          if (overWrite) {
            deleteTournamentStatement.run(existingTournamentId);
          } else {
            console.log(`Skipping ${subFolder} as tournament is already in database.`);
            continue;
          }
        }

        console.log(`Tournament: ${subFolder} | Set: ${set} | Edition: ${edition}`);
        try {
          const { question_set_id: setId, question_set_edition_id: editionId } = findQuestionSetEditionStatement.get(
            set,
            edition
          );
          const roundDictionary = {};
          const playerDictionary = {};
          const teamDictionary = {};
          const tossupDictionary = {};
          const bonusDictionary = {};
          const { lastInsertRowid: tournamentId } = insertTournamentStatement.run(
            tournamentName,
            tournamentSlug,
            editionId,
            location,
            level,
            start_date,
            end_date
          );

          // if round mappings, buzzes, and bonuses are part of index.json, use that instead of game_files
          // NOT recommended or documented, use the game_files folder and the qbj files if you have them
          if (rounds) {
            const gameDictionary = {};
            const buzzesFilePath = path.join(subFolderPath, buzzesFileName);
            const bonusesFilePath = path.join(subFolderPath, bonusesFileName);
            const buzzesContent = await fs.readFile(buzzesFilePath, "utf8");
            const buzzes = buzzesContent.split("\n").slice(1);

            for (let buzz of buzzes) {
              const [
                rawGameId,
                rawRound,
                rawQuestionNumber,
                team,
                player,
                opponent,
                _,
                __,
                ___,
                rawBuzzPosition,
                rawValue,
              ] = buzz.split(",");
              team = cleanName(team);
              player = cleanName(player);
              opponent = cleanName(opponent);
              const gameId = parseInt(rawGameId);
              const round = parseInt(rawRound);
              const questionNumber = parseInt(rawQuestionNumber);
              const buzzPosition = parseInt(rawBuzzPosition);
              const value = parseInt(rawValue);

              // update round dictionary if needed
              if (!roundDictionary[round]) {
                const packetName = rounds.find((r) => r.number === round).packet;
                const { id: packetId } = findPacketByNameStatement.get(editionId, packetName);
                const { lastInsertRowid: roundId } = insertRoundStatement.run(
                  tournamentId,
                  round,
                  packetId,
                  rounds_to_exclude_from_individual_stats?.find((r) => r === round) ? 1 : 0
                );

                roundDictionary[round] = { packetId, roundId };
              }

              // update team dictionary if needed
              if (!teamDictionary[team]) {
                const { lastInsertRowid: teamId } = insertTeamStatement.run(
                  tournamentId,
                  team,
                  slugify(team, slugifyOptions)
                );

                teamDictionary[team] = teamId;
              }

              // update opponent dictionary if needed
              if (!teamDictionary[opponent]) {
                const { lastInsertRowid: teamId } = insertTeamStatement.run(
                  tournamentId,
                  opponent,
                  slugify(opponent, slugifyOptions)
                );

                teamDictionary[opponent] = teamId;
              }

              const packetId = roundDictionary[round].packetId;
              const tossupKey = `${packetId}-${questionNumber}`;
              const playerKey = `${team}-${player}`;

              // update player dictionary if needed
              if (!playerDictionary[playerKey]) {
                let playerSlug = slugify(player, slugifyOptions);
                let existingPlayers = findPlayerBySetIdStatement.all(player, setId);
                if (existingPlayers.length > 0) {
                  let playerTeams = [
                    ...new Set(
                      existingPlayers.map((p) => {
                        let { name: teamName } = findTeamByIdStatement.get(p.team_id);
                        return teamName;
                      })
                    ),
                  ];
                  playerSlug += `-${existingPlayers.length + 1}`;
                  console.log(
                    `\tDuplicate player name found - ${player} already exists on these teams: ${playerTeams.join(
                      ", "
                    )}. Using slug ${playerSlug} for the player on ${team}.`
                  );
                }
                const { lastInsertRowid: playerId } = insertPlayerStatement.run(
                  teamDictionary[team],
                  player,
                  playerSlug,
                  setId
                );

                playerDictionary[playerKey] = playerId;
              }

              // update tossup dictionary if needed
              if (!tossupDictionary[tossupKey]) {
                let packet = findTossupStatement.get(packetId, questionNumber);

                if (!packet) {
                  console.warn(
                    `No tossup ${questionNumber} found in packet ID ${packetId} of tournament ${tournamentName} in game between ${team} and ${opponent}.`
                  );
                  continue;
                }

                tossupDictionary[tossupKey] = packet.id;
              }

              // update game dictionary if needed
              if (!gameDictionary[gameId]) {
                // just gotta hard-code tossups_read as 20. hopefully won't have to use again
                const { lastInsertRowid: insertedGameId } = insertGameStatement.run(
                  roundDictionary[round].roundId,
                  20,
                  teamDictionary[team],
                  teamDictionary[opponent]
                );

                gameDictionary[gameId] = insertedGameId;
              }

              insertBuzzStatement.run(
                playerDictionary[playerKey],
                gameDictionary[gameId],
                tossupDictionary[tossupKey],
                buzzPosition,
                value
              );
            }

            const bonusesContent = await fs.readFile(bonusesFilePath, "utf8");

            const bonuses = bonusesContent.split("\n").slice(1);

            for (let bonusPartDirect of bonuses) {
              const [rawGameId, rawRound, , rawBonus, team, , , , part, , , rawValue] = bonusPartDirect.split(",");
              team = cleanName(team);
              const gameId = parseInt(rawGameId);
              const round = parseInt(rawRound);
              const value = parseInt(rawValue);
              const bonus = parseInt(rawBonus);
              const packetId = roundDictionary[round].packetId;
              const bonusKey = `${packetId}-${bonus}`;
              const teamId = teamDictionary[team];
              const numericPart = parseInt(part.replace(/\D/g, ""));

              if (!bonusDictionary[bonusKey]) {
                let bonusResults = findBonusPartsStatement.all(packetId, bonus);
                bonusDictionary[bonusKey] = bonusResults;
              }

              insertBonusPartDirectStatement.run(
                teamId,
                gameDictionary[gameId],
                bonusDictionary[bonusKey].find((p) => p.part_number === numericPart).id,
                value
              );
            }

            continue;
          }

          if (!existsSync(gamesFilePath)) {
            console.log(`\tSkipping ${subFolder} as ${gamesFolderName} folder not found.`);
            continue;
          }

          const gameFileDirents = filterFiles(
            await fs.readdir(gamesFilePath, {
              withFileTypes: true,
              recursive: true,
            }),
            "qbj"
          );

          for (const gameFileDirent of gameFileDirents) {
            const gameFilePath = path.join(gameFileDirent.parentPath, gameFileDirent.name);
            const gameFile = gameFileDirent.name;
            const gameDataContent = await fs.readFile(gameFilePath, "utf8");

            try {
              const roundNumber = parseInt(gameFile.split("_")[tournament.name.toLowerCase().includes("pace") ? 0 : 1]);
              const gameData = JSON.parse(gameDataContent);
              const packetName = gameData.packets.replaceAll(/\((\d+)\)/g, "").trim();
              let { descriptor: packetDescriptor, number: _ } = parsePacketMetadata(packetName, 0);

              const teamOneName = cleanName(gameData.match_teams[0].team.name);
              const teamTwoName = cleanName(gameData.match_teams[1].team.name);

              if (roundDictionary[roundNumber] && roundDictionary[roundNumber][packetName]) {
                const gameRoundId = roundDictionary[roundNumber][packetName].roundId;
                let existingGameCheck = findGameByRoundAndTeamsStatement.all(
                  gameRoundId,
                  teamDictionary[teamOneName],
                  teamDictionary[teamTwoName]
                );

                if (existingGameCheck.length > 0) {
                  console.log(
                    `\tSkipping duplicate file for game between ${teamOneName} and ${teamTwoName} in round ${roundNumber}.`
                  );
                  continue;
                }
              }

              // update round dictionary if needed
              try {
                const { id: packetId } = findPacketByNameStatement.get(editionId, packetName);
                if (!roundDictionary[roundNumber]) {
                  const { lastInsertRowid: roundId } = insertRoundStatement.run(
                    tournamentId,
                    roundNumber,
                    packetId,
                    rounds_to_exclude_from_individual_stats?.find((r) => r === roundNumber) ? 1 : 0
                  );

                  roundDictionary[roundNumber] = {
                    [packetName]: {
                      packetId,
                      roundId,
                    },
                  };
                } else if (!roundDictionary[roundNumber][packetName]) {
                  const { lastInsertRowid: roundId } = insertRoundStatement.run(
                    tournamentId,
                    parseInt(`${roundNumber}00`),
                    packetId,
                    rounds_to_exclude_from_individual_stats?.find((r) => r === roundNumber) ? 1 : 0
                  );
                  console.log([
                    `\tMultiple packets used for round ${roundNumber} of ${tournamentName}:`,
                    Object.keys(roundDictionary[roundNumber]).join("\n\t\t"),
                    packetName
                  ].join("\n\t\t"));

                  roundDictionary[roundNumber][packetName] = {
                    packetId,
                    roundId,
                  };
                }

                // update team and player dictionaries if needed
                for (let { team } of gameData.match_teams) {
                  let teamName = cleanName(team.name);
                  if (!teamDictionary[teamName]) {
                    const { lastInsertRowid: teamId } = insertTeamStatement.run(
                      tournamentId,
                      teamName,
                      slugify(teamName, slugifyOptions)
                    );

                    teamDictionary[teamName] = teamId;
                  }

                  for (let { name: playerName } of team.players) {
                    playerName = cleanName(playerName);
                    let key = `${teamName}-${playerName}`;

                    if (!playerDictionary[key]) {
                      let existingPlayers = findPlayerBySetIdStatement.all(playerName, setId);
                      let playerSlug = slugify(playerName, slugifyOptions);
                      if (existingPlayers.length > 0) {
                        let playerTeams = [
                          ...new Set(
                            existingPlayers.map((p) => {
                              let { name: teamName } = findTeamByIdStatement.get(p.team_id);
                              return teamName;
                            })
                          ),
                        ];
                        playerSlug += `-${existingPlayers.length + 1}`;
                        console.log(
                          `\tDuplicate player name found - ${playerName} already exists on these teams: ${playerTeams.join(
                            ", "
                          )}. Using slug ${playerSlug} for the player on ${teamName}.`
                        );
                      }
                      const { lastInsertRowid: playerId } = insertPlayerStatement.run(
                        teamDictionary[teamName],
                        playerName,
                        playerSlug,
                        setId
                      );

                      playerDictionary[key] = playerId;
                    }
                  }
                }

                const { lastInsertRowid: gameId } = insertGameStatement.run(
                  roundDictionary[roundNumber][packetName].roundId,
                  gameData.tossups_read,
                  teamDictionary[teamOneName],
                  teamDictionary[teamTwoName]
                );

                // insert buzzes and bonus data
                gameData.match_questions.forEach(({ buzzes, tossup_question: { question_number }, bonus }) => {
                  let packetId = roundDictionary[roundNumber][packetName].packetId;
                  let tossupKey = `${packetId}-${question_number}`;
                  let bonusKey = `${packetId}-${bonus?.question.question_number}`;
                  const packet = findPacketByIdStatement.get(editionId, packetId);

                  // update tossup dictionary if needed
                  if (!tossupDictionary[tossupKey]) {
                    let tossup = findTossupStatement.get(packetId, question_number);

                    if (!tossup) {
                      console.warn(
                        `\tNo tossup ${question_number} found in packet #${packet.number} (${packet.descriptor}) of tournament ${tournamentName} in round ${roundNumber} game between ${teamOneName} and ${teamTwoName}.`
                      );
                      return;
                    }

                    tossupDictionary[tossupKey] = tossup.id;
                  }

                  // update bonus dictionary if needed
                  if (bonus && !bonusDictionary[bonusKey]) {
                    let bonusResults = findBonusPartsStatement.all(packetId, bonus.question.question_number);
                    bonusDictionary[bonusKey] = bonusResults;
                  }

                  for (let { buzz_position, player, team, result } of buzzes) {
                    let playerId = playerDictionary[`${cleanName(team.name)}-${cleanName(player.name)}`];

                    insertBuzzStatement.run(
                      playerId,
                      gameId,
                      tossupDictionary[tossupKey],
                      buzz_position.word_index,
                      result.value
                    );
                  }

                  if (bonus) {
                    let teamId = teamDictionary[cleanName(buzzes.find(({ result }) => result.value > 0).team.name)];
                    let bonusParts = bonusDictionary[bonusKey];

                    if (bonusParts.length) {
                      bonus.parts.forEach((part, index) => {
                        var bonusPart = bonusParts.find((p) => p.part_number === index + 1);

                        if (!bonusPart) {
                          console.warn(
                            `No bonus with part ${index + 1} found for ${bonus.question.question_number
                            } in packet ID ${packetId}, which was directed to ${team.name
                            } at tournament ID ${tournamentId} (${tournamentName}).`
                          );
                          return;
                        }

                        insertBonusPartDirectStatement.run(teamId, gameId, bonusPart.id, part.controlled_points);
                      });
                    }
                  }
                });
              } catch (err) {
                console.warn(
                  `\tCouldn't find packet ${packetDescriptor} in edition ${edition} for game ${gameFile.replaceAll(
                    ".qbj",
                    ""
                  )}.`
                );
                console.log(err);
              }
            } catch (err) {
              console.error(`Error occurred while parsing JSON in ${gameFilePath} and writing it to db (2):`, err);
            }
          }
        } catch (err) {
          console.log(`\tCouldn't find edition ${edition} of question set ${set} for tournament ${subFolder}.`);
        }
      } catch (err) {
        console.error(`Error reading ${indexPath}: `, err);
      }
    }
  } catch (err) {
    console.error("Error reading tournaments folder: ", err);
  }
};

migrateTournaments();
