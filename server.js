    const express = require('express');
    const mongoose = require('mongoose');
    const bodyParser = require('body-parser');
    const cors = require('cors');
    const WebSocket = require('ws');

    const app = express();
    const PORT = process.env.PORT || 8000;
    const MONGO_URI = "mongodb+srv://djenkinsbo6:PXgw5CJ4Rn4zZiUq@bingo-cluster.z0hzwwa.mongodb.net/bingo_db?retryWrites=true&w=majority"; // Використання перемінних оточення

    app.use(cors());
    app.use(bodyParser.json());

    // Middleware для збереження IP-адрес
    app.use((req, res, next) => {
        const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        console.log(`Client IP: ${clientIp}`);
        next();
    });

    mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connected to MongoDB'))
        .catch(err => console.error('Cannot connect to MongoDB', err));

    const userSchema = new mongoose.Schema({
        username: { type: String, required: true },
        telegram_id: { type: Number, unique: true, required: true },
        balance: { type: Number, default: 0 },
        league: { type: String, default: 'wood' },
        multi_tap_level: { type: Number, default: 1 },
        energy_limit_level: { type: Number, default: 1 },
        recharging_speed: { type: Number, default: 1 },
        energy: { type: Number, default: 1500 },
        lastEnergyUpdate: { type: Date, default: Date.now },
        dailyBoosts: {
            tapingGuru: { charges: { type: Number, default: 3 }, lastUpdate: { type: Date, default: Date.now } },
            fullTank: { charges: { type: Number, default: 3 }, lastUpdate: { type: Date, default: Date.now } }
        },
        autoTap: {
            active: { type: Boolean, default: false },
            timeLeft: { type: Number, default: 0 }, // Час, що залишився в мілісекундах
            accumulatedPoints: { type: Number, default: 0 }, // Накопичені очки
            lastUpdate: { type: Date, default: Date.now } // Час останнього оновлення
        },
        leagueProgress: {
            WOOD: { type: Number, default: 0 },
            BRONZE: { type: Number, default: 0 },
            SILVER: { type: Number, default: 0 },
            GOLD: { type: Number, default: 0 },
            DIAMOND: { type: Number, default: 0 },
            MASTER: { type: Number, default: 0 },
            GRANDMASTER: { type: Number, default: 0 }
        }
    });

    const taskSchema = new mongoose.Schema({
        task_name: { type: String, required: true },
        task_id: { type: Number, required: true },
        reward: { type: Number, required: true },
        url: { type: String, required: true },
    });

    const User = mongoose.model('User', userSchema);
    const Task = mongoose.model('Task', taskSchema);

    const calculateEnergy = (user) => {
        const maxEnergy = 1000 + user.energy_limit_level * 500;
        if (user.energy < maxEnergy) {
            const currentTime = new Date();
            const lastUpdate = new Date(user.lastEnergyUpdate);
            const timeDifference = (currentTime.getTime() - lastUpdate.getTime()) / 1000; // Різниця у секундах
            console.log(`currentTime - ${currentTime} - ${lastUpdate}. timeDifference: ${timeDifference}`);
            const baseRecoveryTime = 750; // Базовий час відновлення у секундах
            const recoveryTimePerUnit = baseRecoveryTime / user.recharging_speed; // Час відновлення однієї одиниці енергії
            const energyRecovered = Math.floor((timeDifference / recoveryTimePerUnit) * 1000); // Кількість відновлених одиниць енергії
            console.log(`Energy calculated: ${energyRecovered}, new energy: ${user.energy}, last update: ${user.lastEnergyUpdate}`);
            user.energy = Math.min(user.energy + energyRecovered, maxEnergy); // Відновлена енергія
            user.lastEnergyUpdate = currentTime;
        }
    };

    const updateDailyBoosts = (user) => {
        const now = new Date();


        const eightHours = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

        const boosts = ['tapingGuru', 'fullTank'];
        boosts.forEach(boost => {
            const lastUpdate = new Date(user.dailyBoosts[boost].lastUpdate);
            const timeDifference = (now.getTime() - lastUpdate.getTime());
            console.log(`last upd - ${lastUpdate}, time to difference - ${timeDifference}`);
            if (timeDifference >= eightHours) {
                const chargesToAdd = Math.floor(timeDifference / eightHours);
                user.dailyBoosts[boost].charges = Math.min(user.dailyBoosts[boost].charges + chargesToAdd, 3);
                console.log(`chargesToAdd - ${chargesToAdd}. last upd - ${lastUpdate}, time to difference - ${timeDifference}`);
                user.dailyBoosts[boost].lastUpdate = new Date(lastUpdate.getTime() + chargesToAdd * eightHours);
            }
        });
    };

    const activateAutoTap = (user) => {
        const now = new Date();

        user.autoTap.active = true;
        user.autoTap.timeLeft = 3 * 60 * 60 * 1000; // 3 години в мілісекундах
        user.autoTap.lastUpdate = now;

        // Обнуляємо накопичені очки, коли активується новий AUTO TAP
        user.autoTap.accumulatedPoints = 0;

        return user;
    };

    const updateAutoTapStatus = (user) => {
        const now = new Date();

        // Ensure autoTap is initialized
        if (!user.autoTap) {
            user.autoTap = {
                active: false,
                timeLeft: 0,
                accumulatedPoints: 0,
                lastUpdate: now,
            };
        }

        if (!user.autoTap.active || user.autoTap.timeLeft <= 0) {
            return user;
        }

        const elapsed = now - user.autoTap.lastUpdate;
        const pointsPerMinute = 5; // Points per minute
        const pointsToAdd = Math.floor(elapsed / 60000) * pointsPerMinute; // New points to add
        user.autoTap.accumulatedPoints += pointsToAdd;

        user.autoTap.timeLeft = Math.max(0, user.autoTap.timeLeft - elapsed);
        user.autoTap.lastUpdate = now;

        if (user.autoTap.timeLeft <= 0) {
            user.autoTap.active = false;
        }

        return user;
    };

    const leagueCriteria = {
        WOOD: 0,
        BRONZE: 1000,
        SILVER: 50000,
        GOLD: 250000,
        DIAMOND: 500000,
        MASTER: 750000,
        GRANDMASTER:1000000
    };

    const checkAndUpdateLeague = async (user) => {
        let newLeague = user.league;

        for (const [league, minBalance] of Object.entries(leagueCriteria)) {
            if (user.balance >= minBalance && (leagueCriteria[league] > leagueCriteria[newLeague])) {
                newLeague = league;
            }
        }

        if (newLeague !== user.league) {
            user.league = newLeague;
            await user.save();
        }

        return user;
    };

    const calculateProgressForAllLeagues = (user, criteria) => {
        const currentBalance = user.balance;
        const criteriaEntries = Object.entries(criteria).sort(([, a], [, b]) => a - b);
        const totalLeagues = criteriaEntries.length;
        const progressArray = [];

        for (let i = 0; i < totalLeagues; i++) {
            const [league, balance] = criteriaEntries[i];
            let progress;
            if (i === 0) {
                progress = currentBalance < balance ? (currentBalance / balance) * 100 : 100;
            } else {
                progress = ((currentBalance) / (balance)) * 100;
                progress = Math.min(Math.max(progress, 0), 100);
            }

            // Save the new progress if it's greater than the previous one
            if (progress > user.leagueProgress[league]) {
                user.leagueProgress[league] = progress;
            }

            progressArray.push({ league, progress });
        }

        return progressArray;
    };



    app.get('/api/check-user', async (req, res) => {
        const { telegram_id } = req.query;

        if (!telegram_id) {
            return res.status(400).json({ message: 'Telegram ID is required' });
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (user) {
                calculateEnergy(user); // Оновлення енергії користувача перед відправкою даних
                updateDailyBoosts(user);
                await user.save();

                res.status(200).json({
                    userExists: true,
                    userBalance: user.balance,
                    userLeague: user.league,
                    userEnergy: user.energy,
                    dailyBoosts: user.dailyBoosts
                });
            } else {
                res.status(200).json({ userExists: false });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error checking user', error });
        }
    });

    app.post('/api/create-user', async (req, res) => {
        const { username, telegram_id } = req.body;

        if (!username || !telegram_id) {
            return res.status(400).json({ message: 'Username and Telegram ID are required' });
        }

        try {
            const existingUser = await User.findOne({ telegram_id });

            if (!existingUser) {
                const user = new User({
                    username,
                    telegram_id,
                    balance: 0
                });

                await user.save();
                res.status(201).json({ message: 'User created successfully' });
            } else {
                res.status(200).json({ message: 'User already exists' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error creating user', error });
        }
    });

    app.get('/api/user-balance/:telegram_id', async (req, res) => {
        const { telegram_id } = req.params;

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.json({ balance: user.balance });
        } catch (error) {
            console.error('Error getting user balance:', error);
            res.status(500).json({ message: "Server error" });
        }
    });

    app.put('/api/save-balance/:telegram_id', async (req, res) => {
        const { telegram_id } = req.params;
        const { balance } = req.body;

        if (balance === undefined || balance < 0) {
            return res.status(400).json({ message: 'Valid balance is required' });
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (user) {
                user.balance = balance;
                await user.save();
                res.status(200).json({ message: 'Balance updated successfully' });
            } else {
                res.status(404).json({ message: 'User not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error updating balance', error });
        }
    });

    app.get('/api/tasks', async (req, res) => {
        try {
            const tasks = await Task.find();
            res.json(tasks);
        } catch (error) {
            console.error('Ошибка при получении заданий:', error);
            res.status(500).json({ message: "Server error" });
        }
    });

    app.post('/api/purchase-boost', async (req, res) => {
        const { telegram_id, boostType, price } = req.body;

        if (price === undefined || price < 0) {
            return res.status(400).json({ message: 'Valid price is required' });
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            if (user.balance < price) {
                return res.status(400).json({ message: 'Not enough balance' });
            }

            user.balance -= price;

            switch (boostType) {
                case 'MULTITAP':
                    user.multi_tap_level += 1;
                    break;
                case 'RECHARGE SPEED':
                    user.energy_limit_level += 1;
                    break;
                case 'Recharge Speed':
                    user.recharging_speed += 1;
                    break;
                case 'AUTO TAP':
                    break;
                default:
                    return res.status(400).json({ message: 'Unknown boost type' });
            }

            await user.save();
            res.json({ success: true, newBalance: user.balance });
        } catch (error) {
            console.error('Purchase boost error:', error);
            res.status(500).json({ message: "Server error" });
        }
    });

    app.put('/api/update-league/:telegram_id', async (req, res) => {
        const { telegram_id } = req.params;
        const { newLeague } = req.body;

        if (!newLeague) {
            return res.status(400).json({ message: 'New league is required' });
        }

        try {
            const user = await User.findOneAndUpdate(
                { telegram_id: parseInt(telegram_id) },
                { league: newLeague },
                { new: true }
            );

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            res.json(user);
        } catch (error) {
            console.error('Update league error:', error);
            res.status(500).json({ message: 'Server error' });
        }
    });

    // Запуск сервера
    const server = app.listen(PORT, () => {
        console.log(`Server running on port: ${PORT}`);
    });

    // Підключення WebSocket сервера
    const wss = new WebSocket.Server({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress; // Отримання IP-адреси клієнта
        console.log(`New connection from IP: ${ip}`);

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                console.log(`Received message from IP ${ip}:`, data);

                // Обробка повідомлень від клієнта
                switch (data.type) {
                    case 'requestUserData':
                        await handleRequestUserData(ws, data);
                        break;
                    case 'updateBalance':
                        await handleUpdateBalance(ws, data);
                        break;
                    case 'purchaseBoost':
                        await handlePurchaseBoost(ws, data);
                        break;
                    case 'maximizeEnergy':
                        await handleMaximazeEnergy(ws,data);
                        break;
                    case 'activateBoost':
                        await handleActivateBoost(ws, data);
                        break;
                    case 'activateAutoTap':
                        await handleActivateAutoTap(ws, data);
                        break;
                    case 'claimPoints':
                        await handleClaimPoints(ws, data);
                    case 'getAutoTapStatus': // Новий тип повідомлення для отримання стану AutoTap
                        await handleGetAutoTapStatus(ws, data);
                        break;
                    default:
                        ws.send(JSON.stringify({ type: 'error', message: 'Unknown request type' }));
                        break;
                }
            } catch (error) {
                console.error(`Error handling message from IP ${ip}:`, error);
                ws.send(JSON.stringify({ type: 'error', message: 'Error handling message' }));
            }
        });

        ws.on('close', () => {
            console.log(`Client with IP ${ip} disconnected`);
        });
    });

    // Obработчик запросов данных пользователя
    async function handleRequestUserData(ws, data) {
        const { telegram_id } = data;

        try {
            const user = await User.findOne({ telegram_id });
            if (user) {
                calculateEnergy(user); // Обновление энергии пользователя перед отправкой данных
                updateDailyBoosts(user);
                updateAutoTapStatus(user);
                await checkAndUpdateLeague(user);
                const leagueProgress = calculateProgressForAllLeagues(user, leagueCriteria);
                await user.save();
                ws.send(JSON.stringify({
                    type: 'userData',
                    balance: user.balance,
                    league: user.league,
                    multiTapLevel: user.multi_tap_level,
                    energyLimitLevel: user.energy_limit_level,
                    rechargingSpeed: user.recharging_speed,
                    energy: user.energy, // Добавление энергии в ответ
                    dailyBoosts: user.dailyBoosts,
                    autoTap: user.autoTap,
                    leagueProgress:leagueProgress
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'User not found'
                }));
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error fetching user data' }));
        }
    }

    // Обработчик запросов обновления баланса
    async function handleUpdateBalance(ws, data) {
        const { telegram_id, newBalance, newEnergy } = data;

        if (newBalance === undefined || newBalance < 0 || newEnergy === undefined || newEnergy < 0) {
            return ws.send(JSON.stringify({ type: 'error', message: 'Valid balance and energy are required' }));
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (user) {
                user.balance = newBalance;
                user.energy = newEnergy;
                user.lastEnergyUpdate = new Date();
                await user.save();
                console.log(`new balance - ${newBalance}`)
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'balanceUpdate',
                            telegram_id,
                            newBalance,
                            newEnergy
                        }));
                    }
                });
            }
        } catch (error) {
            console.error('Error updating balance:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error updating balance' }));
        }
    }

    // Обробка запитів на покупку буста
    async function handlePurchaseBoost(ws, data) {
        const { telegram_id, boostType, price } = data;

        if (price === undefined || price < 0) {
            return ws.send(JSON.stringify({ type: 'error', message: 'Valid price is required' }));
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
            }

            if (user.balance < price) {
                return ws.send(JSON.stringify({ type: 'error', message: 'Not enough balance' }));
            }

            user.balance -= price;

            switch (boostType) {
                case 'MULTITAP':
                    user.multi_tap_level += 1;
                    break;
                case 'ENERGY LIMIT':
                    user.energy_limit_level += 1;
                    break;
                case 'RECHARGE SPEED':
                    user.recharging_speed += 1;
                    break;
                case 'AUTO TAP':
                const newbalance=200000;
                user.balance -= newbalance;
                await user.save();
                    break;
                default:
                    return ws.send(JSON.stringify({ type: 'error', message: 'Unknown boost type' }));
            }
            console.log(`New purchase: cost - ${price} , telegramid - ${telegram_id}, new balance - ${user.balance}`);
            await user.save();

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'boostUpdate',
                        telegram_id,
                        balance: user.balance,
                        boostLevels: {
                            multiTapLevel: user.multi_tap_level,
                            energyLimitLevel: user.energy_limit_level,
                            rechargingSpeed: user.recharging_speed,
                        }}));
                }
            });
        } catch (error) {
            console.error('Error purchasing boost:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error purchasing boost' }));
        }
    }
    async function handleMaximazeEnergy(ws,data){
        const { telegram_id } = data;
        const user = await User.findOne({ telegram_id });
        const maxEnergy = 1000 + user.energy_limit_level * 500;
        user.energy = maxEnergy;
        await user.save();
        ws.send(JSON.stringify({ energy: user.energy }));
    }
    async function handleActivateBoost(ws, data) {
        const { telegram_id, boost } = data;

        try {
            const user = await User.findOne({ telegram_id });

            if (user && user.dailyBoosts[boost].charges > 0) {
                user.dailyBoosts[boost].charges -= 1;
                user.dailyBoosts[boost].lastUpdate = new Date();
                await user.save();

                ws.send(JSON.stringify({
                    type: ' boostActivated',
                    telegram_id,
                    boost,
                    chargesLeft: user.dailyBoosts[boost].charges
                }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'No boosts left or user not found' }));
            }
        } catch (error) {
            console.error('Error activating boost:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error activating boost' }));
        }
    }
    async function handleActivateAutoTap(ws, data) {
        const { telegram_id } = data;

        try {
            const user = await User.findOne({ telegram_id });

            if (user && user.balance >= 100) {
                user.balance -= 100;
                activateAutoTap(user); // Функція активації AUTO TAP, яку ви вже маєте
                await user.save();

                ws.send(JSON.stringify({
                    type: 'autoTapActivated',
                    telegram_id,
                    autoTap: user.autoTap,
                    newBalance: user.balance  // Додайте новий баланс до відповіді
                }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Insufficient balance or user not found' }));
            }
        } catch (error) {
            console.error('Error activating auto tap:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error activating auto tap' }));
        }
    }

    const handleClaimPoints = async (ws, data) => {
        const { telegram_id } = data;

        try {
            const user = await User.findOne({ telegram_id });

            if (user && user.autoTap.accumulatedPoints > 0) {
                const pointsToAdd = user.autoTap.accumulatedPoints;
                user.balance += pointsToAdd;
                user.autoTap.accumulatedPoints = 0;
                await user.save();

                ws.send(JSON.stringify({
                    type: 'pointsClaimed',
                    telegram_id,
                    pointsClaimed: pointsToAdd,
                    newBalance: user.balance  // Додайте новий баланс до відповіді
                }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'No points to claim or user not found' }));
            }
        } catch (error) {
            console.error('Error claiming points:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error claiming points' }));
        }
    }
