const Database = require('better-sqlite3');

// Create or open the SQLite database file
const db = new Database('database.db');
const { shortenAnswerline, removeTags, slugifyOptions, toTitleCase } = require('./utils');
const slugify = require('slugify');

const { existsSync } = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { parseMetadata, formatTypes, metadataTypes } = require('./metadata-utils');
const crypto = require('crypto');

require('dotenv').config();

const basePath = process.env.BASE_PATH || './';
const questionSetsPath = path.join(basePath, 'data/question_sets');
const editionsFolderName = 'editions';
const packetsFolderName = 'packet_files';
const overWriteFlag = '--overwrite';
const overWrite = process.argv.find(a => a === overWriteFlag);

const insertQuestionSetStatement = db.prepare('INSERT INTO question_set (name, slug, difficulty, format, bonuses) VALUES (?, ?, ?, ?, ?)');
const insertQuestionSetEditionStatement = db.prepare('INSERT INTO question_set_edition (question_set_id, name, slug, date) VALUES (?, ?, ?, ?)');
const insertPacketStatement = db.prepare('INSERT INTO packet (question_set_edition_id, name, descriptor, number) VALUES (?, ?, ?, ?)');
const insertPacketQuestionStatement = db.prepare('INSERT INTO packet_question (packet_id, question_number, question_id) VALUES (?, ?, ?)');
const insertQuestionStatement = db.prepare('INSERT INTO question (slug, metadata, author, editor, category, category_slug, subcategory, subcategory_slug, subsubcategory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertTossupStatement = db.prepare('INSERT INTO tossup (question_id, question, answer, answer_sanitized, answer_primary) VALUES (?, ?, ?, ?, ?)');
const insertBonusStatement = db.prepare('INSERT INTO bonus (question_id, leadin, leadin_sanitized) VALUES (?, ?, ?)');
const insertBonusPartStatement = db.prepare('INSERT INTO bonus_part (bonus_id, part_number, part, part_sanitized, answer, answer_sanitized, answer_primary, value, difficulty_modifier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
const findQuestionSetStatement = db.prepare('SELECT id FROM question_set WHERE slug = ?');
const findQuestionSetEditionStatement = db.prepare('SELECT question_set_edition.id FROM question_set_edition JOIN question_set ON question_set_id = question_set.id WHERE question_set.slug = ? AND question_set_edition.slug = ? ');
const deleteQuestionSetEditionStatement = db.prepare('DELETE FROM question_set_edition WHERE id = ?');
const insertTossupHashStatement = db.prepare('INSERT INTO tossup_hash (hash, question_id, tossup_id) VALUES (?, ?, ?)');
const insertBonusHashStatement = db.prepare('INSERT INTO bonus_hash (hash, question_id, bonus_id) VALUES (?, ?, ?)');
const findTossupStatement = db.prepare(`
    SELECT  question_id AS questionId,
            tossup_id AS tossupId
    FROM    tossup_hash
    WHERE   hash = ?
`);
const findBonusStatement = db.prepare(`
    SELECT  question_id AS questionId,
            bonus_id AS tossupId
    FROM    bonus_hash
    WHERE   hash = ?
`);

const packetWords = ["packet", "round"];

function parsePacketMetadata(packetFileName, index) {
    let packetNumber = index;
    let packetInteger = Math.max.apply(null, packetFileName.match(/\d+/g));
    let packetDescriptor = "";
    let cleanedPacketFileName = packetFileName.toLowerCase();
    let cleanedPacketFileNameParts = cleanedPacketFileName.split(/[-–—_,.:|\s+]/);
    if (packetWords.some(s => cleanedPacketFileName.includes(s))) {
        let packetWordIndex = packetWords.findIndex(s => cleanedPacketFileName.includes(s));
        packetDescriptor = toTitleCase(cleanedPacketFileNameParts[packetWordIndex + 1]);
        let packetIdentifierNumber = Math.max.apply(null, packetDescriptor.match(/\d+/g))
        if (packetIdentifierNumber > 0) {
            packetNumber = packetIdentifierNumber;
        }
    } else if (packetInteger > 0) {
        packetNumber = packetInteger;
        packetDescriptor = packetInteger.toString();
    } else if (index) {
        packetDescriptor = index.toString();
    } else {
        console.log(`\tUnable to detect packet number or identifier for ${packetFileName}. Setting number to ${index} and identifier to ${packetFileName}.`);
        packetDescriptor = packetFileName;
    }
    return { descriptor: packetDescriptor, number: packetNumber }
}

const getHash = (questionText) => {
    return crypto.createHash('md5').update(questionText).digest('hex');
}

const insertTossup = (packetId, questionNumber, question, answer, answer_sanitized, answerSlug, metadata, author, editor, category, subcategory, subsubcategory, slugDictionary) => {
    let questionHash = getHash(`${question}${answer}${metadata}`);
    let { questionId, tossupId } = findTossupStatement.get(questionHash) || {};

    if (!questionId) {
        if (slugDictionary[answerSlug]) {
            slugDictionary[answerSlug] += 1;
            answerSlug = answerSlug + '-' + slugDictionary[answerSlug];
        } else {
            slugDictionary[answerSlug] = 1;
        }

        questionId = insertQuestionStatement.run(
            answerSlug, metadata,
            author, editor,
            category ? category : null, category ? slugify(category.toLowerCase()) : null,
            subcategory ? subcategory : null, subcategory ? slugify(subcategory.toLowerCase()) : null,
            subsubcategory ? slugify(subsubcategory.toLowerCase()) : null
        ).lastInsertRowid;
        tossupId = insertTossupStatement.run(
            questionId, question, answer, answer_sanitized, shortenAnswerline(answer_sanitized)
        ).lastInsertRowid;
        insertTossupHashStatement.run(questionHash, questionId, tossupId);
    }

    insertPacketQuestionStatement.run(packetId, questionNumber, questionId);

    return tossupId;
}

const insertBonus = (packetId, questionNumber, leadin, answers, answersSlug, parts, values, difficultyModifiers, metadata, author, editor, category, subcategory, subsubcategory, slugDictionary) => {
    if (!difficultyModifiers) {
        console.warn(`\tDifficulty modifiers missing for bonus ${questionNumber} in packet ID ${packetId} with answerlines:\n\t\t${answers.join("\n\t\t")}`);
        return -1;
    }
    try {
        let primaryAnswers = answers.map(a => shortenAnswerline(removeTags(a)));
        if ((new Set(difficultyModifiers)).size !== 3) {
            console.warn(`Duplicate difficulty modifiers in bonus ${questionNumber} in packet ${packetId} with answerlines [${primaryAnswers.join(", ")}]: [${difficultyModifiers.join(", ")}].`);
            return -1;
        } else {
            let questionHash = getHash(`${leadin}${parts.join('')}${answers.join('')}${metadata}`);
            let { questionId, bonusId } = findBonusStatement.get(questionHash) || {};

            if (!questionId) {
                if (slugDictionary[answersSlug]) {
                    slugDictionary[answersSlug] += 1;
                    answersSlug = answersSlug + '-' + slugDictionary[answersSlug];
                } else {
                    slugDictionary[answersSlug] = 1;
                }

                questionId = insertQuestionStatement.run(
                    answersSlug, metadata,
                    author, editor,
                    category ? category : null, category ? slugify(category.toLowerCase()) : null,
                    subcategory ? subcategory : null, subcategory ? slugify(subcategory.toLowerCase()) : null,
                    subsubcategory ? slugify(subsubcategory.toLowerCase()) : null
                ).lastInsertRowid;
                bonusId = insertBonusStatement.run(questionId, leadin, removeTags(leadin)).lastInsertRowid;

                for (let i = 0; i < answers.length; i++) {
                    insertBonusPartStatement.run(
                        bonusId, i + 1,
                        parts[i], removeTags(parts[i]),
                        answers[i], removeTags(answers[i]),
                        primaryAnswers[i],
                        values ? values[i] : null,
                        difficultyModifiers ? difficultyModifiers[i] : null
                    );
                }

                insertBonusHashStatement.run(questionHash, questionId, bonusId);
            }

            insertPacketQuestionStatement.run(packetId, questionNumber, questionId);

            return bonusId;
        }
    } catch (err) {
        console.log(`\tError parsing bonus ${questionNumber} of packet ID ${packetId} with\n\tanswerlines:\n\t${answers.join("\n\t")}`);
        console.log(err);
    }
}

const migrateQuestionSets = async () => {
    try {
        const subFolders = (await fs.readdir(questionSetsPath, { withFileTypes: true }))
                    .filter(f => !(["DS_Store", "zip"].map(s => f.name.endsWith(`${s}`)).some(f => f)))
                    .map(f => f.name);

        for (const subFolder of subFolders) {
            const subFolderPath = path.join(questionSetsPath, subFolder);
            const indexPath = path.join(subFolderPath, 'index.json');
            let slugDictionary = {};

            if (!existsSync(indexPath)) {
                console.log(`Skipping ${subFolder} as 'index.json' file not found.`);
                continue;
            }

            try {
                const questionSetData = await fs.readFile(indexPath, "utf8");
                const questionSet = JSON.parse(questionSetData);
                const editionsPath = path.join(subFolderPath, editionsFolderName);
                let { name: setName, slug, difficulty, format, bonuses } = questionSet;
                format = format ? format : "powers";
                bonuses = (bonuses !== undefined) ? +bonuses : +true;
                let { id: questionSetId } = findQuestionSetStatement.get(slug) || {};

                if (!questionSetId) {
                    questionSetId = insertQuestionSetStatement.run(setName, slug, difficulty, format, bonuses).lastInsertRowid;
                }

                if (!existsSync(editionsPath)) {
                    console.log(`Skipping ${subFolder} as ${editionsPath} folder not found.`);
                    continue;
                }

                try {
                    const editionsFolders = (await fs.readdir(editionsPath, { withFileTypes: true }))
                        .filter(f => !(["DS_Store", "zip"].map(s => f.name.endsWith(`${s}`)).some(f => f)))
                        .map(f => f.name);

                    for (const editionFolder of editionsFolders) {
                        const subFolderPath = path.join(editionsPath, editionFolder);
                        const indexPath = path.join(subFolderPath, 'index.json');

                        if (!existsSync(indexPath)) {
                            console.log(`Skipping ${editionFolder} as 'index.json' file not found.`);
                            continue;
                        }

                        try {
                            const editionData = await fs.readFile(indexPath, 'utf8');

                            try {
                                const edition = JSON.parse(editionData);
                                const packetsFilePath = path.join(subFolderPath, packetsFolderName);
                                const { name: editionName, slug: editionSlug, date } = edition;

                                if (!existsSync(packetsFilePath)) {
                                    console.log(`\tSkipping ${subFolder} as ${packetsFilePath} folder not found.`);
                                    continue;
                                }

                                let { id: questionSetEditionId } = findQuestionSetEditionStatement.get(slug, editionSlug) || {};

                                if (questionSetEditionId) {
                                    if (overWrite) {
                                        deleteQuestionSetEditionStatement.run(questionSetEditionId);
                                    } else {
                                        console.log(`\tSkipping ${editionName} as edition is already in database.`);
                                        continue;
                                    }
                                }

                                questionSetEditionId = insertQuestionSetEditionStatement.run(questionSetId, editionName, editionSlug, date).lastInsertRowid;

                                try {
                                    const packetFiles = (await fs.readdir(packetsFilePath, { withFileTypes: true }))
                                        .filter(f => !(["DS_Store", "zip"].map(s => f.name.endsWith(`${s}`)).some(f => f)))
                                        .map(f => f.name);

                                    for (const [i, packetFile] of packetFiles.entries()) {
                                        const gameFilePath = path.join(packetsFilePath, packetFile);
                                        const packetName = packetFile.replace(".json", "");
                                        let { descriptor: packetDescriptor, number: packetNumber } = parsePacketMetadata(packetName, i + 1);

                                        console.log(`Set: ${setName} | Edition: ${editionName} | Packet #${packetNumber} | ID: ${packetDescriptor} | Filename: ${packetFile}`);
                                        try {
                                            const packetDataContent = await fs.readFile(gameFilePath);
                                            const packetData = JSON.parse(packetDataContent);
                                            const { lastInsertRowid: packetId } = insertPacketStatement.run(questionSetEditionId, packetName, packetDescriptor, packetNumber);

                                            let numTossups = 0;
                                            let numBonuses = 0;

                                            packetData.tossups?.forEach(({ question, answer, metadata }, index) => {
                                                if (metadata || questionSet.metadataStyle === metadataTypes.none) {
                                                    const { author, category, subcategory, subsubcategory, editor } = parseMetadata(metadata, questionSet.metadataStyle);
                                                    const sanitizedAnswer = removeTags(answer);
                                                    const answerSlug = slugify(shortenAnswerline(removeTags(answer)).slice(0, 50), slugifyOptions);

                                                    if (answerSlug) {
                                                        let tossupId = insertTossup(
                                                            packetId,
                                                            index + 1,
                                                            question,
                                                            answer,
                                                            sanitizedAnswer,
                                                            answerSlug,
                                                            metadata,
                                                            author,
                                                            editor,
                                                            category,
                                                            subcategory,
                                                            subsubcategory,
                                                            slugDictionary
                                                        );
                                                        if (tossupId > 0) {
                                                            numTossups += 1;
                                                        }
                                                    } else {
                                                        console.log(`\tError in saving data for tossup ${index + 1}: Couldn't process answer slug.`);
                                                    }
                                                } else {
                                                    console.log(`\tError in saving data for tossup ${index + 1}: Couldn't process metadata.`)
                                                }
                                            });

                                            if (bonuses) {
                                                packetData.bonuses?.forEach(({ leadin, metadata, answers, parts, values, difficultyModifiers }, index) => {
                                                    if (metadata || questionSet.metadataStyle === metadataTypes.none) {
                                                        const { author, category, subcategory, subsubcategory, editor } = parseMetadata(metadata, questionSet.metadataStyle);
                                                        const answersSlug = slugify(answers?.map(a => shortenAnswerline(removeTags(a)).slice(0, 25)).join(" "), slugifyOptions)

                                                        if (answersSlug) {
                                                            let bonusId = insertBonus(
                                                                packetId,
                                                                index + 1,
                                                                leadin,
                                                                answers,
                                                                answersSlug,
                                                                parts,
                                                                values,
                                                                difficultyModifiers,
                                                                metadata,
                                                                author,
                                                                editor,
                                                                category,
                                                                subcategory,
                                                                subsubcategory,
                                                                slugDictionary
                                                            );
                                                            if (bonusId > 0) {
                                                                numBonuses += 1;
                                                            }
                                                        } else {
                                                            console.log(`\tError in saving data for bonus ${index + 1}: Couldn't process answer slug.`);
                                                        }
                                                    } else {
                                                        console.log(`\tError in saving data for bonus ${index + 1}: Couldn't process metadata.`)
                                                    }
                                                });
                                            }

                                            console.log(`\t${numTossups} tossups` + (bonuses ? `, ${numBonuses} bonuses` : ""));
                                        } catch (err) {
                                            console.error(`Error processing ${gameFilePath}: `, err);
                                        }
                                    }
                                } catch (err) {
                                    console.error(`Error reading files in ${packetsFilePath}: `, err);
                                }
                            } catch (err) {
                                console.error(`Error creating set edition at ${indexPath}: `, err)
                            }
                        } catch (err) {
                            console.error(`Error reading ${indexPath}:`, err);
                        }
                    }
                } catch (err) {
                    console.error('Error reading editions folder: ', err);
                }
            } catch (err) {
                console.error(`Error reading ${indexPath}: `, err);
            }
        }
    } catch (err) {
        console.error('Error reading question sets folder: ', err);
    }
}

migrateQuestionSets();