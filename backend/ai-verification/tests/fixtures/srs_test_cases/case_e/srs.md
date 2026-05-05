# Software Requirements Specification (SRS)
## Stock Market Historical Data Collection Program (NSE)

---

## 1. Introduction

### 1.1 Purpose
The purpose of this system is to collect, store, and manage historical stock market data from the National Stock Exchange of India (NSE). The system is intended for analysts, students, and developers who require structured stock data for analysis, visualization, and algorithmic trading.

### 1.2 Scope
The system will:
- Fetch historical stock data (OHLCV format)
- Support multiple NSE-listed stock symbols
- Store data locally (CSV and SQLite database)
- Provide querying and export functionality

---

## 2. Overall Description

### 2.1 Product Perspective
This is a standalone Python-based application with a Command-Line Interface (CLI). It can be extended into a web or GUI-based application in the future.

### 2.2 User Classes
- **Beginner Users**: Download stock data easily
- **Analysts**: Perform financial and quantitative analysis
- **Developers**: Integrate into data pipelines or applications

### 2.3 Operating Environment
- Operating System: Windows, Linux, macOS
- Programming Language: Python 3.9+
- Libraries: requests, pandas, sqlite3, yfinance

---

## 3. Functional Requirements

### 3.1 Data Collection
- The system shall fetch historical stock data using NSE-compatible APIs or libraries.
- Input:
  - Stock symbol (e.g., RELIANCE.NS)
  - Start date
  - End date
- Output:
  - Dataset containing Date, Open, High, Low, Close, Volume

### 3.2 Data Storage
- The system shall store fetched data in:
  - CSV files
  - SQLite database

### 3.3 Data Retrieval
- The system shall allow users to query stored data by:
  - Stock symbol
  - Date range

### 3.4 Data Export
- The system shall allow exporting queried data into CSV format.

### 3.5 Error Handling
- The system shall handle:
  - Invalid stock symbols
  - Network/API failures
  - Empty datasets

---

## 4. Non-Functional Requirements

### 4.1 Performance
- Data fetching should complete within 5–10 seconds per request under normal conditions.

### 4.2 Reliability
- The system should retry failed API calls up to 3 times.

### 4.3 Usability
- The system shall provide a simple and intuitive CLI interface.

### 4.4 Security
- The system shall not store sensitive user data.
- The system shall respect API rate limits.

---

## 5. System Architecture

[User CLI]
↓
[Data Fetch Module]
↓
[Processing Module]
↓
[Storage Module (CSV / SQLite)]
↓
[Query Module]


---

## 6. Data Design

### 6.1 Database Schema

**Table: stock_data**

| Field   | Type    | Description              |
|--------|--------|--------------------------|
| symbol | TEXT   | Stock symbol             |
| date   | TEXT   | Trading date             |
| open   | REAL   | Opening price            |
| high   | REAL   | Highest price            |
| low    | REAL   | Lowest price             |
| close  | REAL   | Closing price            |
| volume | INTEGER| Trading volume           |

Primary Key: (symbol, date)

---

## 7. Constraints
- Depends on third-party APIs or libraries for stock data.
- Internet connection is required.
- NSE may restrict automated access.

---

## 8. Assumptions
- Users have basic knowledge of stock symbols.
- System runs in a stable Python environment.

---

## 9. Future Enhancements
- Graphical User Interface (GUI)
- Web dashboard
- Real-time stock data integration
- Machine learning-based predictions

---

## 10. Glossary

- **NSE**: National Stock Exchange of India  
- **OHLCV**: Open, High, Low, Close, Volume  
- **CLI**: Command Line Interface  
- **API**: Application Programming Interface  

---