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
    league: { type: String, default: 'silver' },
    multi_tap_level: { type: Number, default: 1 },
    energy_limit_level: { type: Number, default: 1 },
    recharging_speed: { type: Number, default: 1 },
    energy: { type: Number, default: 1500 },
    lastEnergyUpdate: { type: Date, default: Date.now }
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
    const currentTime = new Date();
    const lastUpdate = new Date(user.lastEnergyUpdate);
    const timeDifference = (currentTime.getTime() - lastUpdate.getTime()) / 1000; // Різниця у секундах

    const baseRecoveryTime = 750; // Базовий час відновлення у секундах
    const recoveryTimePerUnit = baseRecoveryTime / user.recharging_speed; // Час відновлення однієї одиниці енергії
    const energyRecovered = Math.floor((timeDifference / recoveryTimePerUnit) * 1000); // Кількість відновлених одиниць енергії
    const maxEnergy = 1000 + user.energy_limit_level * 500; // Максимальна енергія

    user.energy = Math.min(user.energy + energyRecovered, maxEnergy); // Відновлена енергія
    user.lastEnergyUpdate = currentTime;
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
            await user.save();

            res.status(200).json({
                userExists: true,
                userBalance: user.balance,
                userLeague: user.league,
                userEnergy: user.energy
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
            case 'Energy Limit':
                user.energy_limit_level += 1;
                break;
            case 'Recharge Speed':
                user.recharging_speed += 1;
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
            await user.save();

            ws.send(JSON.stringify({
                type: 'userData',
                balance: user.balance,
                league: user.league,
                multiTapLevel: user.multi_tap_level,
                energyLimitLevel: user.energy_limit_level,
                rechargingSpeed: user.recharging_speed,
                energy: user.energy // Добавление энергии в ответ
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
            case 'Energy Limit':
                user.energy_limit_level += 1;
                break;
            case 'Recharge Speed':
                user.recharging_speed += 1;
                break;
            default:
                return ws.send(JSON.stringify({ type: 'error', message: 'Unknown boost type' }));
        }

        await user.save();

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'boostUpdate',
                    telegram_id,
                    balance: user.balance,
                    boostType,
                    newLevel: boostType === 'MULTITAP' ? user.multi_tap_level :
                        boostType === 'Energy Limit' ? user.energy_limit_level :
                            user.recharging_speed,
                    energy: user.energy // Додавання енергії в відповідь
                }));
            }
        });
    } catch (error) {
        console.error('Error purchasing boost:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Error purchasing boost' }));
    }
}
