    const express = require('express');
    const mongoose = require('mongoose');
    const bodyParser = require('body-parser');
    const cors = require('cors');
    const WebSocket = require('ws');
    const logger = require('./logger');

    const app = express();
    const PORT = process.env.PORT || 8000;
    const MONGO_URI = "mongodb+srv://djenkinsbo6:PXgw5CJ4Rn4zZiUq@bingo-cluster.z0hzwwa.mongodb.net/bingo_db?retryWrites=true&w=majority"; // Використання перемінних оточення

    app.use(cors());
    app.use(bodyParser.json());

    // Middleware для збереження IP-адрес
    app.use((req, res, next) => {
        const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        logger.info('Connection from client', { clientIp });
        next();
    });

    mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connected to MongoDB'))
        .catch(err => console.error('Cannot connect to MongoDB', err));

    const userSchema = new mongoose.Schema({
        username: { type: String, required: true },
        telegram_id: { type: Number, unique: true, required: true },
        balance: { type: Number, default: 0 },
        ref_balance: { type: Number, default: 0 },
        referral_count: { type: Number, default: 0 },
        league: { type: String, default: 'WOOD' },
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
        },
        lastLogin: Date,
        isOnline: Boolean
    });

    const taskSchema = new mongoose.Schema({
        task_name: { type: String, required: true },
        task_id: { type: Number, required: true },
        reward: { type: Number, required: true },
        url: { type: String, required: true },
    });

    const User = mongoose.model('User', userSchema);
    const Task = mongoose.model('Task', taskSchema);
    module.exports = User;

    app.use(async (req, res, next) => {
        if (req.user) {
            await User.updateOne(
                { _id: req.user._id },
                { lastLogin: new Date(), isOnline: true }
            );
        }
        next();
    });

const ONLINE_THRESHOLD = 5 * 60 * 1000; // 5 хвилин
const TOKEN = "eyJhbGciOiJIUzI1NiJ9"
setInterval(async () => {
    const now = new Date();
    const offlineThreshold = new Date(now - ONLINE_THRESHOLD);

        await User.updateMany(
            { lastLogin: { $lt: offlineThreshold }, isOnline: true },
            { isOnline: false }
        );
    }, ONLINE_THRESHOLD);

app.get(`/api/${TOKEN}/stats`, async (req, res) => {
    try {
        const totalShareBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
        const totalPlayers = await User.countDocuments({});
        const dailyPlayers = await User.countDocuments({ lastLogin: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
        const onlinePlayers = await User.countDocuments({ isOnline: true });

            res.json({
                totalShareBalance: totalShareBalance[0]?.total || 0,
                totalPlayers,
                dailyPlayers,
                onlinePlayers
            });
        } catch (error) {
            res.status(500).send(error.toString());
        }
    });

    const calculateEnergy = (user) => {
        const maxEnergy = 1000 + user.energy_limit_level * 500;
        if (user.energy < maxEnergy) {
            const currentTime = new Date();
            const lastUpdate = new Date(user.lastEnergyUpdate);
            const timeDifference = (currentTime.getTime() - lastUpdate.getTime()) / 1000; // Різниця у секундах


            const baseRecoveryTime = 750; // Базовий час відновлення у секундах
            const recoveryTimePerUnit = baseRecoveryTime / user.recharging_speed; // Час відновлення однієї одиниці енергії
            const energyRecovered = Math.floor((timeDifference / recoveryTimePerUnit) * 1000); // Кількість відновлених одиниць енергії

            user.energy = Math.min(user.energy + energyRecovered, maxEnergy); // Відновлена енергія
            user.lastEnergyUpdate = currentTime;
            // Логування після оновлення енергії
            logger.info('Energy updated', {
                telegram_id: user.telegram_id,
                newEnergy: user.energy,
                lastEnergyUpdate: user.lastEnergyUpdate
            });
        }
    };

    const updateDailyBoosts = (user) => {
        const now = new Date();
        const eightHours = 8 * 60 * 60 * 1000; // 8 часов в миллисекундах
        let newChargesAdded = false;

        const boosts = ['tapingGuru', 'fullTank'];
        boosts.forEach(boost => {
            const lastUpdate = new Date(user.dailyBoosts[boost].lastUpdate);
            const timeDifference = (now.getTime() - lastUpdate.getTime());
            if (timeDifference >= eightHours) {
                const previousCharges = user.dailyBoosts[boost].charges;
                const chargesToAdd = 3;
                user.dailyBoosts[boost].charges = Math.min(user.dailyBoosts[boost].charges + chargesToAdd, 3);
                user.dailyBoosts[boost].lastUpdate = new Date(lastUpdate.getTime() + chargesToAdd * eightHours);

                if (previousCharges < 3 && user.dailyBoosts[boost].charges === 3) {
                    newChargesAdded = true;
                }
            }
        });

        return newChargesAdded;
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
        const pointsPerMinute = 60; // Points per minute
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



    app.get('/api/eyJhbGciOiJIUzI1NiJ9/check-user', async (req, res) => {
        const { telegram_id } = req.query;

        if (!telegram_id) {
            return res.status(400).json({ message: 'Telegram ID is required' });
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (user) {
                calculateEnergy(user); // Оновлення енергії користувача перед відправкою даних
                const newChargesAdded = updateDailyBoosts(user);
                await user.save();

                res.status(200).json({
                    userExists: true,
                    userBalance: user.balance,
                    userLeague: user.league,
                    userEnergy: user.energy,
                    dailyBoosts: user.dailyBoosts,
                    newChargesAdded
                });
            } else {
                res.status(200).json({ userExists: false });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error checking user', error });
        }
    });

app.post(`/api/${TOKEN}/create-user`, async (req, res) => {
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

app.get(`/api/${TOKEN}/user-balance/:telegram_id`, async (req, res) => {
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

app.put(`/api/${TOKEN}/save-balance/:telegram_id`, async (req, res) => {
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

app.get(`/api/${TOKEN}/tasks`, async (req, res) => {
    try {
        const tasks = await Task.find();
        res.json(tasks);
    } catch (error) {
        console.error('Ошибка при получении заданий:', error);
        res.status(500).json({ message: "Server error" });
    }
});

    // Add this new route below your other routes
    app.get(`/api/${TOKEN}/accumulated-points/:telegram_id`, async (req, res) => {
        const { telegram_id } = req.params;

            try {
                const user = await User.findOne({ telegram_id });

                if (!user) {
                    return res.status(404).json({ message: 'User not found' });
                }

                res.json({ accumulatedPoints: user.autoTap.accumulatedPoints });
            } catch (error) {
                console.error('Error getting accumulated points:', error);
                res.status(500).json({ message: 'Server error' });
            }
        });

app.post(`/api/${TOKEN}/purchase-boost`, async (req, res) => {
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

    app.put(`/api/${TOKEN}/maximize-energy/:telegram_id`, async (req, res) => {
        const { telegram_id } = req.params;

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Максимальне значення енергії
            const maxEnergy = 1000 + user.energy_limit_level * 500;
            user.energy = maxEnergy;
            user.lastEnergyUpdate = new Date();

            await user.save();

            res.status(200).json({
                message: 'Energy maximized successfully',
                newEnergy: user.energy,
                lastEnergyUpdate: user.lastEnergyUpdate
            });
        } catch (error) {
            console.error('Error maximizing energy:', error);
            res.status(500).json({ message: 'Server error', error });
        }
    });

app.put(`/api/${TOKEN}/update-league/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;

        try {
            const user = await User.findOne({ telegram_id: parseInt(telegram_id) });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const updatedUser = await checkAndUpdateLeague(user);
            res.json({ league: updatedUser.league });
        } catch (error) {
            console.error('Update league error:', error);
            res.status(500).json({ message: 'Server error' });
        }
    });

app.get(`/api/${TOKEN}/user-referral_count/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.json({ referral_count: user.referral_count });
        } catch (error) {
            console.error('Error getting user referral_count:', error);
            res.status(500).json({ message: "Server error" });
        }
    });

app.put(`/api/${TOKEN}/save-referral_count/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;
    const { referral_count } = req.body;

        if (referral_count === undefined || referral_count < 0) {
            return res.status(400).json({ message: 'Valid balance is required' });
        }

        try {
            const user = await User.findOne({ telegram_id });

        if (user) {
            user.referral_count = referral_count;
            await user.save();
            res.status(200).json({ message: 'referral_count updated successfully' });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error updating referral_count', error });
    }
});

app.get(`/api/${TOKEN}/user-ref_balance/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.json({ ref_balance: user.ref_balance });
        } catch (error) {
            console.error('Error getting user ref_balance:', error);
            res.status(500).json({ message: "Server error" });
        }
    });

app.put(`/api/${TOKEN}/save-ref_balance/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;
    const { ref_balance } = req.body;

        if (ref_balance === undefined || ref_balance < 0) {
            return res.status(400).json({ message: 'Valid balance is required' });
        }

        try {
            const user = await User.findOne({ telegram_id });

            if (user) {
                user.ref_balance = ref_balance;
                await user.save();
                res.status(200).json({ message: 'ref_balance updated successfully' });
            } else {
                res.status(404).json({ message: 'User not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error updating ref_balance', error });
        }
    });

app.get(`/api/${TOKEN}/user-referrals/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;

    try {
        const user = await User.findOne({ telegram_id });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Return only the list of referred user IDs
        res.json({ referrals: user.referrals });
    } catch (error) {
        console.error('Error getting user referrals:', error);
        res.status(500).json({ message: "Server error" });
    }
});

app.get(`/api/${TOKEN}/user-exist/:telegram_id`, async (req, res) => {
    const { telegram_id } = req.params;

        try {
            const user = await User.findOne({ telegram_id });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.json({ telegram_id: user.telegram_id });

        } catch (error) {
            console.error('Error getting user', error);
            res.status(500).json({ message: "Server error" });
        }
    });

    // Запуск сервера
    const server = app.listen(PORT, () => {
        console.log(`Server running on port: ${PORT}`);
    });

    // Підключення WebSocket сервера
    const wss = new WebSocket.Server({ server, path: '/ws/eyJSb2xlIjoiQWRtaW4iLCJJc3N1ZXI' });

    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress; // Отримання IP-адреси клієнта
        logger.info('New connection', { ip, path: req.url });
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                logger.info('Message received', { ip, telegram_id: data.userId, data });
                const userId = data.telegram_id;
                ws.userId = userId;
                // Update the user's status to online in the database
                await User.findOneAndUpdate({telegram_id: userId}, { isOnline: true});
                await User.findOneAndUpdate({telegram_id: userId}, { lastLogin: new Date() });
                // Обробка повідомлень від клієнта
                switch (data.type) {
                    case 'requestUserData':
                        await handleRequestUserData(ws, data);
                        break;
                    case 'updateBalance':
                        await handleUpdateBalance(ws, data);
                        break;
                    case 'purchaseBoost':
                        console.log("purhase boost is required");
                        await handlePurchaseBoost(ws, data);
                        break;
                    case 'maximizeEnergy':
                        console.log('Received maximizeEnergy request:', data);
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
                    default:
                        ws.send(JSON.stringify({ type: 'error', message: 'Unknown request type' }));
                        break;
                }
            } catch (error) {
                console.error(`Error handling message from IP ${ip}:`, error);
                ws.send(JSON.stringify({ type: 'error', message: 'Error handling message' }));
            }
        });

        ws.on('close', async () => {
            logger.error('Error handling message', { ip, telegram_id: ws.userId });
                // Update the user's status to offline in the database
                await User.findOneAndUpdate({ telegram_id: ws.userId }, { isOnline: false });

        });
    });

    // Obработчик запросов данных пользователя
    async function handleRequestUserData(ws, data) {
        const { telegram_id } = data;

        try {
            const user = await User.findOne({ telegram_id });
            if (user) {
                calculateEnergy(user); // Обновление энергии пользователя перед отправкой данных
                const { newChargesAdded } = updateDailyBoosts(user);
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
                    leagueProgress:leagueProgress,
                    referral_count:user.referral_count
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'User not found'
                }));
            }
        } catch (error) {
            logger.error('Error fetching user data', { telegram_id, error });
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
                logger.info('Balance updated', { telegram_id, newBalance, newEnergy });
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
            logger.error('Error updating balance', { telegram_id, error });
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
                await user.save();
                    break;
                default:
                    return ws.send(JSON.stringify({ type: 'error', message: 'Unknown boost type' }));
            }
            logger.info('Boost purchased', { telegram_id, boostType, price, newBalance: user.balance });
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
            logger.error('Error purchasing boost', { telegram_id, error });
            ws.send(JSON.stringify({ type: 'error', message: 'Error purchasing boost' }));
        }
    }
    async function handleMaximazeEnergy(ws, data) {
        const { telegram_id } = data;

        try {
            const user = await User.findOne({ telegram_id });

            if (user) {
                const maxEnergy = 1000 + user.energy_limit_level * 500;
                user.energy = maxEnergy;
                await user.save();
                ws.send(JSON.stringify({ type: 'energyMaximized', energy: user.energy }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
            }
        } catch (error) {
            console.error('Error maximizing energy:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Server error' }));
        }
    }

    async function handleActivateBoost(ws, data) {
        const { telegram_id, boost } = data;

        try {
            const user = await User.findOne({ telegram_id });

            if (user && user.dailyBoosts[boost].charges > 0) {
                user.dailyBoosts[boost].charges -= 1;
                user.dailyBoosts[boost].lastUpdate = new Date();
                await user.save();
                console.log(boost, user.dailyBoosts[boost].charges)
                ws.send(JSON.stringify({
                    type: 'boostActivated',
                    telegram_id,
                    boost,
                    chargesLeft: user.dailyBoosts[boost].charges
                }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'No boosts left or user not found' }));
            }
        } catch (error) {
            logger.error('Error activating boost:', { telegram_id, error });
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
                logger.info('AUTO TAP Boost activated', { telegram_id});

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
            logger.error('Error activating auto tap boost', { telegram_id, error });
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
                logger.info('Points claimed activated', { telegram_id ,balance: user.balance});
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