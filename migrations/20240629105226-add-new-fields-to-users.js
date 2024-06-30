const mongoose = require('mongoose');
const User = require('D:/Artem/Bingo-back-end/server.js'); // Обновите путь к модели пользователя

async function migrate() {
  try {
    // Подключение к базе данных
    await mongoose.connect('mongodb+srv://djenkinsbo6:PXgw5CJ4Rn4zZiUq@bingo-cluster.z0hzwwa.mongodb.net/bingo_db?retryWrites=true&w=majority', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Подключение к базе данных установлено.');

    // Обновление всех существующих документов пользователей
    await User.updateMany(
        {}, // Условие для обновления всех документов
        {
          $set: {
            lastLogin: null,
            isOnline: false
          }
        }
    );

    console.log('Миграция завершена.');
  } catch (error) {
    console.error('Ошибка миграции:', error);
  } finally {
    // Закрытие соединения с базой данных
    await mongoose.disconnect();
    console.log('Соединение с базой данных закрыто.');
  }
}

migrate();
