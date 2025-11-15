const express = require('express');
const cors = require('cors');
const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Import routes
const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const transferRoutes = require('./routes/transfer');
// Import ONE combined payment route file
const paymentRoutes = require('./routes/payment');

// Link routes
app.use('/api', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/vehicles', transferRoutes); 

// ✅ FIXED: Mount your single, combined payment router under /api/payments
app.use('/api/payments', paymentRoutes);

// Start server
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});