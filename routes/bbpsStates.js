const express = require('express');
const router = express.Router();
const bbpsBillPay = require('../providers/bbps/bbpsBillPay');

// Get all states
router.get('/states', async (req, res) => {
  try {
    const states = await bbpsBillPay.getStates();
    
    // Format for Flutter
    const formattedStates = states.map(state => ({
      stateCode: state.stateCode || state.code || '',
      stateName: state.stateName || state.name || '',
    }));
    
    res.json({
      success: true,
      data: formattedStates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get cities for a state
router.get('/cities/:stateCode', async (req, res) => {
  try {
    const cities = await bbpsBillPay.getCities(req.params.stateCode);
    
    // Format for Flutter
    const formattedCities = cities.map(city => ({
      cityCode: city.cityCode || city.code || '',
      cityName: city.cityName || city.name || '',
    }));
    
    res.json({
      success: true,
      data: formattedCities
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;