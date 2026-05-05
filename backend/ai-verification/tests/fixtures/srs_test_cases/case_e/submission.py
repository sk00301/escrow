import sqlite3
import pandas as pd
import yfinance as yf
from datetime import datetime

DB_NAME = "stocks.db"

# ---------------------------
# Database Setup
# ---------------------------
def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stock_data (
        symbol TEXT,
        date TEXT,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume INTEGER,
        PRIMARY KEY (symbol, date)
    )
    """)

    conn.commit()
    conn.close()

# ---------------------------
# Fetch Data
# ---------------------------
def fetch_stock_data(symbol, start_date, end_date):
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start_date, end=end_date)

        if df.empty:
            print("No data found.")
            return None

        df.reset_index(inplace=True)
        df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
        return df

    except Exception as e:
        print("Error fetching data:", e)
        return None

# ---------------------------
# Store Data
# ---------------------------
def store_data(symbol, df):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    for _, row in df.iterrows():
        try:
            cursor.execute("""
            INSERT OR REPLACE INTO stock_data
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                symbol,
                row["Date"],
                row["Open"],
                row["High"],
                row["Low"],
                row["Close"],
                int(row["Volume"])
            ))
        except Exception as e:
            print("Insert error:", e)

    conn.commit()
    conn.close()
    print("Data stored successfully.")

# ---------------------------
# Query Data
# ---------------------------
def query_data(symbol, start_date, end_date):
    conn = sqlite3.connect(DB_NAME)

    query = """
    SELECT * FROM stock_data
    WHERE symbol=? AND date BETWEEN ? AND ?
    ORDER BY date
    """

    df = pd.read_sql_query(query, conn, params=(symbol, start_date, end_date))
    conn.close()

    return df

# ---------------------------
# Export to CSV
# ---------------------------
def export_to_csv(df, filename):
    df.to_csv(filename, index=False)
    print(f"Data exported to {filename}")

# ---------------------------
# CLI Interface
# ---------------------------
def main():
    init_db()

    while True:
        print("\n--- NSE Data Collector ---")
        print("1. Fetch & Store Data")
        print("2. Query Data")
        print("3. Exit")

        choice = input("Enter choice: ")

        if choice == "1":
            symbol = input("Enter symbol (e.g., RELIANCE.NS): ")
            start = input("Start date (YYYY-MM-DD): ")
            end = input("End date (YYYY-MM-DD): ")

            df = fetch_stock_data(symbol, start, end)
            if df is not None:
                store_data(symbol, df)

        elif choice == "2":
            symbol = input("Enter symbol: ")
            start = input("Start date: ")
            end = input("End date: ")

            df = query_data(symbol, start, end)
            print(df)

            save = input("Export to CSV? (y/n): ")
            if save.lower() == 'y':
                filename = f"{symbol}_{start}_{end}.csv"
                export_to_csv(df, filename)

        elif choice == "3":
            break

        else:
            print("Invalid choice.")

if __name__ == "__main__":
    main()