// setupDatabase.js
const pool = require('./db'); // This imports your pool from db.js

async function createTables() {
  console.log('Attempting to create tables...');
  let connection;

  // SQL query to create the driving_licenses table
  const createLicenseTableQuery = `
    CREATE TABLE driving_licenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      dob DATE NOT NULL,
      license_number VARCHAR(100) NOT NULL UNIQUE,
      license_type VARCHAR(50) DEFAULT 'Learner',
      status VARCHAR(50) DEFAULT 'Applied',
      application_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // SQL query to create the vehicles table
  const createVehicleTableQuery = `
    CREATE TABLE vehicles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      registration_number VARCHAR(100) NOT NULL UNIQUE,
      owner_name VARCHAR(255) NOT NULL,
      model VARCHAR(100),
      registration_date DATE,
      fitness_valid_upto DATE,
      tax_status VARCHAR(50) DEFAULT 'Paid'
    );
  `;

  try {
    // Get a connection from the pool
    connection = await pool.getConnection();
    console.log('Database connection acquired.');

    // Execute the queries
    await connection.query(createLicenseTableQuery);
    console.log('Table "driving_licenses" created');

    await connection.query(createVehicleTableQuery);
    console.log('Table "vehicles" created');
    
    console.log('✅ All tables set up successfully!');

  } catch (error) {
    console.error('❌ Error setting up tables:', error);
  } finally {
    // Release the connection back to the pool
    if (connection) {
      connection.release();
      console.log('Database connection released.');
    }
    // End the pool
    pool.end();
  }
}

// Run the function
createTables();