const express = require('express');
const router = express.Router();
const pool = require('../db'); 
// ✅ 1. GET user details (keep it separate)
router.get('/user/:id', async (req, res) => {
  try {
    const { id } = req.params; 
    const [userRows] = await pool.query(
      'SELECT full_name, email, pan_number, phone_number, address_line1, city, state, pincode FROM Users WHERE user_id = ?',
      [id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json(userRows[0]);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ message: 'Server error fetching user data.' });
  }
});

// NEW: Updated route to handle backend sorting and filtering
router.get('/user/:userId/vehicles', async (req, res) => {
  const { userId } = req.params;
  
  // Get search and sort parameters from the query string
  // e.g., /vehicles?search=GA01&sort=reg_expiring
  const { search = '', sort = 'default' } = req.query;

  try {
    // Base query selects from the view for the correct user
    let sql = 'SELECT * FROM v_UserVehicleDetails WHERE user_id = ?';
    const params = [userId];

    // --- 1. Add SQL LIKE Operator (Search) ---
    // If a search term is provided, add the LIKE clause
    if (search) {
      sql += ' AND registration_number LIKE ?';
      // Add wildcards to the search term
      params.push(`%${search}%`);
    }

    let orderByClause = '';
    switch (sort) {
      case 'reg_expiring':
        orderByClause = 'ORDER BY registration_valid_upto ASC';
        break;
      case 'ins_expiring':
        orderByClause = 'ORDER BY insurance_end_date ASC';
        break;
      case 'alphabetical':
        orderByClause = 'ORDER BY registration_number ASC';
        break;
      default:
        // Default sort (e.g., newest applications first)
        orderByClause = 'ORDER BY registration_number DESC'; // Changed from registration_number
    }

    // Append the final clauses to the main query
    sql += ` ${orderByClause}`;

    // --- 3. Execute the single, powerful query ---
    const [results] = await pool.query(sql, params);

    // It's not an error to find no results.
    // The frontend will handle displaying "No vehicles found."
    res.status(200).json(results); // Send array (empty or with data)

  } catch (err) {
    console.error("Error fetching from view:", err);
    res.status(500).json({ error: "Database query failed" });
  }
});

// --- *** MODIFIED REGISTRATION ROUTE *** ---
router.post('/register', async (req, res) => {
  // We MUST use a connection for transactions
  const connection = await pool.getConnection();
  
  try {
    const {
      owner_id, chassis_number, engine_number, make, model, vehicle_class, fuel_type, manufacture_year,
      dealer_name, purchase_date, ex_showroom_price, rto_office_code,
      company_name, policy_number, policy_type, start_date, end_date,
      on_loan, lender_name, lender_address
    } = req.body;

    // --- 1. Calculate Road Tax ---
    const roadTax = parseFloat(ex_showroom_price) * 0.08;

    // --- *** NEW ***: 2. START THE TRANSACTION ---
    // This is the most important SQL concept here. It ensures
    // that ALL inserts (Vehicle, Registration, Payment, etc.)
    // either ALL succeed or ALL fail together.
    await connection.beginTransaction();
    
    // --- 1b. Generate Temporary Registration Number (Unchanged) ---
    const timestamp = Date.now().toString().slice(-6);
    const tempRegNumber = `${rto_office_code}-${timestamp}`;

    // 3. Insert into 'Vehicles' table
    const vehicleSql = `
      INSERT INTO Vehicles (
        chassis_number, engine_number, make, model, manufacture_year, 
        fuel_type, vehicle_class, seating_capacity 
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    // *** MODIFIED ***: Use 'connection.query' instead of 'pool.query'
    await connection.query(vehicleSql, [
      chassis_number, engine_number, make, model, manufacture_year,
      fuel_type, vehicle_class, 5 // Defaulting seating to 5
    ]);

    // 4. Insert into 'Registrations' table
    const regSql = `
      INSERT INTO Registrations (
        owner_id, chassis_number, application_date, rto_office_code, 
        application_status, dealer_name, purchase_date, ex_showroom_price,
        road_tax_amount, registration_number, registration_date, valid_upto
      ) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 15 YEAR))
    `;
    // *** MODIFIED ***: Use 'connection.query' and set status to 'Pending Payment'
    const [regResult] = await connection.query(regSql, [
      owner_id, chassis_number, rto_office_code, 
      'Submitted', // *** MODIFIED ***: More accurate status
      dealer_name, purchase_date, ex_showroom_price,
      roadTax, tempRegNumber, purchase_date, purchase_date 
    ]);

    const newApplicationId = regResult.insertId;

    // 5. Insert into 'Insurance' table
    const insSql = `
      INSERT INTO Insurance (
        policy_number, application_id, company_name, policy_type, 
        start_date, end_date
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    // *** MODIFIED ***: Use 'connection.query'
    await connection.query(insSql, [
      policy_number, newApplicationId, company_name, policy_type,
      start_date, end_date
    ]);

    // 6. Insert into 'Hypothecations' (if 'on_loan' is true)
    if (on_loan === true || on_loan === 'on') {
      const hypSql = `
        INSERT INTO Hypothecations (
          application_id, lender_name, lender_address, loan_agreement_date
        ) VALUES (?, ?, ?, CURDATE())
      `;
      // *** MODIFIED ***: Use 'connection.query'
      await connection.query(hypSql, [newApplicationId, lender_name, lender_address]);
    }

    // --- *** NEW ***: 7. CREATE THE PENDING PAYMENT ---
    // This insert is now part of the same transaction.
    // We use the `roadTax` amount calculated in step 1.
    const paymentSql = `
      INSERT INTO Payments (
        application_id, 
        payment_for, 
        amount, 
        payment_status, 
        created_at
      ) VALUES (?, ?, ?, ?, NOW())
    `;
    // *** NEW ***: Insert the payment record
    const [paymentResult] = await connection.query(paymentSql, [
      newApplicationId,
      'New Registration', // As defined in your ENUM
      roadTax,
      'Pending'           // As defined in your ENUM
    ]);
    
    // *** NEW ***: Get the new payment_id
    const newPaymentId = paymentResult.insertId;


    // --- *** NEW ***: 8. COMMIT THE TRANSACTION ---
    // All inserts were successful, so we commit them to the database.
    await connection.commit();

    // --- *** MODIFIED ***: 9. Send the new payment_id to the frontend ---
    // The frontend *must* receive this ID so it can
    // redirect to the payment page.
    res.status(201).json({ 
        message: 'Vehicle registration submitted. Proceed to payment.', 
        applicationId: newApplicationId,
        registration_number: tempRegNumber,
        payment_id: newPaymentId // <-- The new, crucial part
    });

  } catch (error) {
    // --- *** NEW ***: 10. ROLLBACK THE TRANSACTION ---
    // If any error occurred (e.g., duplicate chassis),
    // this command undoes ALL inserts from this transaction.
    await connection.rollback();
    
    console.error('Error during vehicle registration transaction:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'This Chassis Number or Engine Number is already registered.' });
    }
    res.status(500).json({ message: 'Server error during vehicle registration.' });
  } finally {
    // --- *** NEW ***: 11. Release the connection ---
    // Always release the connection back to the pool
    // whether the transaction succeeded or failed.
    connection.release();
  }
});


// --- Renew Registration Route ---
// Path: POST /api/vehicles/renew
router.post('/renew', async (req, res) => {
    // *** NOTE ***: This route should ALSO create a 'Pending' payment
    // for the renewal fee, just like the register route.
    // I am leaving it as-is for now, as the fee logic is not defined.
    
    const connection = await pool.getConnection();
    
    try {
        const {
            user_id, registration_number, policy_number, 
            company_name, policy_type, start_date, end_date
        } = req.body;
        
        // --- 2. Find and Verify the Registration ---
        const findSql = `
            SELECT application_id, owner_id, valid_upto 
            FROM Registrations 
            WHERE registration_number = ?
        `;
        const [regRows] = await connection.query(findSql, [registration_number]);

        if (regRows.length === 0) {
            await connection.release();
            return res.status(404).json({ message: 'Registration number not found.' });
        }

        const registration = regRows[0];
        const oldValidUpto = new Date(registration.valid_upto);

        // --- 3a. Security Check: Does this user own this vehicle? ---
        if (registration.owner_id.toString() !== user_id.toString()) { // Added toString() for safety
            await connection.release();
            return res.status(403).json({ message: 'Forbidden. You do not own this vehicle.' });
        }

        // --- 3b. Check if Renewal is Due ---
        const today = new Date();
        const renewalWindow = new Date();
        renewalWindow.setDate(today.getDate() + 60); // Set renewal window (e.g., 60 days from now)

        if (oldValidUpto > renewalWindow) {
            await connection.release();
            return res.status(400).json({ 
                message: `Renewal is not yet due. You can renew after ${renewalWindow.toDateString()}.` 
            });
        }

        // --- 4. Start the Database Transaction ---
        await connection.beginTransaction();

        // --- 5. Update the Registration Table ---
        const [newValidUptoRows] = await connection.query(
            'SELECT DATE_ADD(?, INTERVAL 15 YEAR) AS new_date', 
            [oldValidUpto]
        );
        const newValidUpto = newValidUptoRows[0].new_date;

        const updateRegSql = `
            UPDATE Registrations
            SET valid_upto = ?
            WHERE application_id = ?
        `;
        await connection.query(updateRegSql, [newValidUpto, registration.application_id]);

        // --- 6. Update the Insurance Table ---
        const deleteInsSql = 'DELETE FROM Insurance WHERE application_id = ?';
        await connection.query(deleteInsSql, [registration.application_id]);

        const insertInsSql = `
            INSERT INTO Insurance 
                (policy_number, application_id, company_name, policy_type, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        await connection.query(insertInsSql, [
            policy_number, registration.application_id, company_name, 
            policy_type, start_date, end_date
        ]);
        
        // --- 7. Log this renewal in the history table ---
        const historySql = `
            INSERT INTO Renewal_History 
                (application_id, renewal_date, old_valid_upto, new_valid_upto, new_policy_number)
            VALUES (?, CURDATE(), ?, ?, ?)
        `;
        
        await connection.query(historySql, [
            registration.application_id,
            oldValidUpto, 
            newValidUpto,
            policy_number
        ]);

        // --- 8. Commit all changes ---
        await connection.commit();

        res.status(200).json({ 
            message: `Registration ${registration_number} renewed successfully!`
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error during registration renewal:', error);
        res.status(500).json({ message: 'Server error during renewal.' });
    } finally {
        connection.release();
    }
});

module.exports = router;