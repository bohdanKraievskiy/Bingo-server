const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

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
});

const taskSchema = new mongoose.Schema({
    task_name: String,
    task_id: { type: Number },
    reward: { type: Number },
    url: String,
});

const boostSchema = new mongoose.Schema({
    boost_id: { type: Number },
    name: { type: String },
    price: { type: Number, default: 5000 },
    level: { type: Number, default: 1 },
});
const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const Boost = mongoose.model('Boost', boostSchema);

// Маршрут для проверки пользователя
app.get('/api/check-user', async (req, res) => {
    const telegram_id = parseInt(req.query.telegram_id);
    try {
        const user = await User.findOne({ telegram_id: telegram_id });
        if (user) {
            res.json({ userExists: true, userId: user._id, userBalance: user.balance, userLeague: user.league });
        } else {
            res.json({ userExists: false });
        }
    } catch (err) {
        console.error('Error checking user:', err);
        res.status(500).json({ detail: "Server error" });
    }
});

// Маршрут для создания пользователя
app.post('/api/create-user', async (req, res) => {
    const { username, telegram_id, leaguage } = req.body;
    try {
        const user = new User({ username, telegram_id, leaguage });
        await user.save();
        res.json({ id: user._id });
    } catch (err) {
        if (err.code === 11000) {  // Ошибка дублирования ключа
            res.status(400).json({ detail: "User already exist" });
        } else {
            console.error('Error creating user:', err);
            res.status(500).json({ detail: "Server error" });
        }
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
        const user = await User.findOneAndUpdate(
            { telegram_id: parseInt(telegram_id) },
            { balance: balance },
            { new: true }
        );

        if (!user) {
            return res.status(404).send('User not found');
        }

        console.log(`Update balance: ${user.balance}`);
        res.send(user);
    } catch (error) {
        console.error('Update balance error:', error);
        res.status(500).send('Server error');
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

app.get('/api/boosts', async (req, res) => {
    try {
        const boosts = await Boost.find(); // Получение всех бустов из базы данных
        console.log('Boosts fetched:', boosts);
        res.json(boosts); // Возвращаем их в ответе
    } catch (err) {
        console.error('sts:', err);
        res.status(500).json({ detail: "Server error" });
    }
});

// Маршрут для покупки буста
app.post('/api/purchase-boost', async (req, res) => {
    const { telegram_id, boost_name, price } = req.body;

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
