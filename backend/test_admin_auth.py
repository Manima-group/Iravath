import getpass
import httpx

BASE_URL = "http://127.0.0.1:8000"

email = input("Admin email: ").strip()
password = getpass.getpass("Admin password: ")

with httpx.Client(timeout=10) as client:
    login = client.post(
        f"{BASE_URL}/api/admin/login",
        json={
            "email": email,
            "password": password,
        },
    )

    print("\nLogin status:", login.status_code)

    if login.status_code != 200:
        print("Login failed:", login.text)
        raise SystemExit(1)

    token = login.json()["token"]

    response = client.get(
        f"{BASE_URL}/api/admin/me",
        headers={
            "Authorization": f"Bearer {token}"
        },
    )

    print("Admin /me status:", response.status_code)
    print("Response:", response.text)
