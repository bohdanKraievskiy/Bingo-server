const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const https = require('https');
// Инициализация приложения
const app = express();
const PORT = process.env.PORT || 8000;
const MONGO_URI = "mongodb+srv://djenkinsbo6:PXgw5CJ4Rn4zZiUq@bingo-cluster.z0hzwwa.mongodb.net/bingo_db?retryWrites=true&w=majority";

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Подключение к MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Cannot connect to MongoDB', err));

// Определение схемы и модели пользователя
const userSchema = new mongoose.Schema({
    username: String,
    telegram_id: { type: Number, unique: true },
    balance: { type: Number, default: 0 },
    league: { type: String, default: 'silver' },
    multi_tap_level: { type: Number, default: 1 },
    energy_limit_level: { type: Number, default: 1 },
    recharging_speed: { type: Number, default: 0 }
});

const taskSchema = new mongoose.Schema({
    task_name: String,
    task_id: { type: Number },
    reward: { type: Number },
    url: String,
});

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const Boost = mongoose.model('Boost', boostSchema);

// Маршрут для проверки пользователя
app.get('/api/check-user', async (req, res) => {
    const { telegram_id } = req.query;
    try {
        const user = await User.findOne({ telegram_id });

        if (user) {
            res.status(200).json({
                userExists: true,
                userBalance: user.balance,
                userLeague: user.league // Відправлення ліги користувача
            });
        } else {
            res.status(200).json({ userExists: false });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error checking user', error });
    }
});

// Маршрут для создания пользователя
app.post('/api/create-user', async (req, res) => {
    const { username, telegram_id } = req.body;
    try {
        const existingUser = await User.findOne({ telegram_id });

        if (!existingUser) {
            const user = new User({
                username,
                telegram_id,
                balance: 0, // Начальный баланс
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

// Маршрут для получения баланса пользователя
app.get('/api/user-balance/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;
    try {
        const user = await User.findOne({ telegram_id: telegram_id });
        if (!user) {
            return res.status(404).json({ detail: "User not found" });
        }
        res.json({ balance: user.balance });
    } catch (err) {
        console.error('Error getting user balance:', err);
        res.status(500).json({ detail: "Server error" });
    }
});

// Маршрут для збереження балансу користувача
app.put('/api/save-balance/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;
    const { balance } = req.body;

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
        const tasks = await Task.find(); // Получение всех заданий из базы данных
        console.log('Tasks fetched:', tasks);
        res.json(tasks); // Возвращаем их в ответе
    } catch (err) {
        console.error('Ошибка при получении заданий:', err);
        res.status(500).json({ detail: "Ошибка сервера" });
    }
});

// Маршрут для покупки буста
app.post('/api/purchase-boost', async (req, res) => {
    const { telegram_id, price } = req.body;

    try {
        const user = await User.findOne({ telegram_id });

        if (!user) {
            return res.status(404).json({ detail: "User not found" });
        }

        if (user.balance < price) {
            return res.status(400).json({ detail: "Not enough balance" });
        }

        user.balance -= price;
        await user.save();

        res.json({ success: true, newBalance: user.balance });
    } catch (error) {
        console.error('Purchase boost error:', error);
        res.status(500).json({ detail: "Server error" });
    }
});

// Маршрут для обновления лиги пользователя
app.put('/api/update-league/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;
    const { newLeague } = req.body;

    try {
        const user = await User.findOneAndUpdate(
            { telegram_id: parseInt(telegram_id) },
            { league: newLeague },
            { new: true }
        );

        if (!user) {
            return res.status(404).send('User not found');
        }

        console.log(`Updated league to: ${user.league}`);
        res.send(user);
    } catch (error) {
        console.error('Update league error:', error);
        res.status(500).send('Server error');
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
});
