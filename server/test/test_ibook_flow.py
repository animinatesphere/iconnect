import os
import re
import unittest
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import Settings, create_app
from server.app.security import hash_session_token


class FakeResult:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row if self.row is not None else (self.rows[0] if self.rows else None)

    def fetchall(self):
        return self.rows


class FakeIbookConnection:
    def __init__(self, state):
        self.state = state

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            user = self.state["users"].get(session["user_id"]) if session else None
            return FakeResult(user.copy() if user else None)
        if sql.startswith("insert into ibook_stay_listings"):
            host_id, property_type, title, location, price, price_unit, guests, description, images = parameters
            listing_id = str(uuid4())
            self.state["stays"][listing_id] = {
                "id": listing_id, "host_id": str(host_id), "property_type": property_type,
                "title": title, "location": location, "price": price, "price_unit": price_unit,
                "max_guests": guests, "description": description, "image_urls": images,
                "created_at": datetime.now(timezone.utc),
            }
            return FakeResult({"id": listing_id})
        if sql.startswith("select listing.id") and "where listing.id = %s" in sql:
            listing = self.state["stays"].get(str(parameters[0]))
            return FakeResult(self._stay_row(listing) if listing else None)
        if sql.startswith("select listing.id") and "where listing.active" in sql:
            rows = [
                self._stay_row(listing)
                for listing in self.state["stays"].values()
                if not parameters[:-1] or parameters[0].strip("%") in listing["location"].lower()
            ]
            return FakeResult(rows=rows[:parameters[-1]])
        if sql.startswith("select id, host_id, max_guests from ibook_stay_listings"):
            listing = self.state["stays"].get(str(parameters[0]))
            if not listing:
                return FakeResult()
            return FakeResult({"id": listing["id"], "host_id": listing["host_id"], "max_guests": listing["max_guests"]})
        if sql.startswith("select id from ibook_stay_bookings") and "id <>" not in sql:
            listing_id, check_out, check_in = parameters
            for booking in self.state["stay_bookings"].values():
                if (
                    booking["listing_id"] == str(listing_id)
                    and booking["status"] == "confirmed"
                    and booking["check_in"] < check_out
                    and booking["check_out"] > check_in
                ):
                    return FakeResult({"id": booking["id"]})
            return FakeResult()
        if sql.startswith("insert into ibook_stay_bookings"):
            listing_id, guest_id, check_in, check_out, guests, message = parameters
            booking_id = str(uuid4())
            self.state["stay_bookings"][booking_id] = {
                "id": booking_id, "listing_id": str(listing_id), "guest_id": str(guest_id),
                "check_in": check_in, "check_out": check_out, "guests": guests,
                "message": message, "status": "requested", "created_at": datetime.now(timezone.utc),
            }
            return FakeResult({"id": booking_id})
        if sql.startswith("select booking.id, booking.listing_id"):
            viewer_id = str(parameters[0])
            rows = []
            for booking in self.state["stay_bookings"].values():
                listing = self.state["stays"][booking["listing_id"]]
                if viewer_id not in {booking["guest_id"], listing["host_id"]}:
                    continue
                guest = self.state["users"][booking["guest_id"]]
                host = self.state["users"][listing["host_id"]]
                rows.append({
                    **booking, "title": listing["title"], "host_id": listing["host_id"],
                    "guest_name": guest["display_name"], "guest_username": guest["username"],
                    "host_name": host["display_name"], "host_username": host["username"],
                })
            return FakeResult(rows=rows)
        if sql.startswith("select booking.listing_id, booking.guest_id"):
            booking = self.state["stay_bookings"].get(str(parameters[0]))
            if not booking:
                return FakeResult()
            listing = self.state["stays"][booking["listing_id"]]
            return FakeResult({
                "listing_id": booking["listing_id"], "guest_id": booking["guest_id"],
                "host_id": listing["host_id"], "status": booking["status"],
                "check_in": booking["check_in"], "check_out": booking["check_out"],
            })
        if sql.startswith("select id from ibook_stay_listings where id =") and "for update" in sql:
            return FakeResult({"id": str(parameters[0])})
        if sql.startswith("select id from ibook_stay_bookings") and "id <>" in sql:
            listing_id, exclude_id, target_id, _same_target = parameters
            target = self.state["stay_bookings"][str(target_id)]
            for booking in self.state["stay_bookings"].values():
                if (
                    booking["id"] != str(exclude_id)
                    and booking["listing_id"] == str(listing_id)
                    and booking["status"] == "confirmed"
                    and booking["check_in"] < target["check_out"]
                    and booking["check_out"] > target["check_in"]
                ):
                    return FakeResult({"id": booking["id"]})
            return FakeResult()
        if sql.startswith("update ibook_stay_bookings set status ="):
            status, booking_id, allowed_statuses = parameters
            booking = self.state["stay_bookings"].get(str(booking_id))
            if not booking or booking["status"] not in allowed_statuses:
                return FakeResult()
            booking["status"] = status
            return FakeResult({"id": booking["id"]})
        if sql.startswith("insert into ibook_driver_profiles"):
            driver_id, vehicle_type, description, area, seats, available = parameters
            profile = {
                "driver_id": str(driver_id), "vehicle_type": vehicle_type,
                "vehicle_description": description, "service_area": area,
                "seats": seats, "available": available,
            }
            self.state["drivers"][str(driver_id)] = profile
            return FakeResult(profile.copy())
        if sql.startswith("select id from ibook_ride_requests") and "driver_id = %s" in sql and "status = 'accepted'" in sql:
            driver_id = str(parameters[0])
            active = next((
                ride for ride in self.state["rides"].values()
                if ride["driver_id"] == driver_id and ride["status"] == "accepted"
            ), None)
            return FakeResult({"id": active["id"]} if active else None)
        if sql.startswith("select driver_id from ibook_driver_profiles where driver_id") and "for update" in sql:
            profile = self.state["drivers"].get(str(parameters[0]))
            if "and available" in sql:
                return FakeResult({"driver_id": profile["driver_id"]} if profile and profile["available"] else None)
            return FakeResult({"driver_id": profile["driver_id"]} if profile else None)
        if sql.startswith("select driver_id, vehicle_type") and "from ibook_driver_profiles where driver_id" in sql:
            profile = self.state["drivers"].get(str(parameters[0]))
            return FakeResult(profile.copy() if profile else None)
        if sql.startswith("select profile.driver_id"):
            passengers = parameters[0]
            viewer_id = str(parameters[1])
            rows = []
            for profile in self.state["drivers"].values():
                if profile["available"] and profile["seats"] >= passengers and profile["driver_id"] != viewer_id:
                    user = self.state["users"][profile["driver_id"]]
                    rows.append({
                        **profile, "updated_at": datetime.now(timezone.utc),
                        "display_name": user["display_name"], "username": user["username"],
                    })
            return FakeResult(rows=rows)
        if sql.startswith("select driver_id, seats from ibook_driver_profiles"):
            profile = self.state["drivers"].get(str(parameters[0]))
            if not profile or not profile["available"]:
                return FakeResult()
            return FakeResult({"driver_id": profile["driver_id"], "seats": profile["seats"]})
        if sql.startswith("insert into ibook_ride_requests"):
            rider_id, driver_id, pickup, destination, pickup_time, passengers, note = parameters
            ride_id = str(uuid4())
            self.state["rides"][ride_id] = {
                "id": ride_id, "rider_id": str(rider_id), "driver_id": str(driver_id),
                "pickup": pickup, "destination": destination, "pickup_time": pickup_time,
                "passengers": passengers, "note": note, "status": "requested",
                "created_at": datetime.now(timezone.utc),
            }
            return FakeResult({"id": ride_id})
        if sql.startswith("select ride.id, ride.rider_id"):
            viewer_id = str(parameters[0])
            rows = []
            for ride in self.state["rides"].values():
                if viewer_id not in {ride["rider_id"], ride["driver_id"]}:
                    continue
                rider = self.state["users"][ride["rider_id"]]
                driver = self.state["users"][ride["driver_id"]]
                rows.append({
                    **ride, "rider_name": rider["display_name"],
                    "rider_username": rider["username"], "driver_name": driver["display_name"],
                    "driver_username": driver["username"],
                })
            return FakeResult(rows=rows)
        if sql.startswith("select rider_id, driver_id, status from ibook_ride_requests"):
            ride = self.state["rides"].get(str(parameters[0]))
            return FakeResult({
                "rider_id": ride["rider_id"], "driver_id": ride["driver_id"],
                "status": ride["status"],
            } if ride else None)
        if sql.startswith("select id from ibook_ride_requests"):
            driver_id, exclude_id = map(str, parameters)
            active = next((
                ride for ride in self.state["rides"].values()
                if ride["driver_id"] == driver_id and ride["id"] != exclude_id and ride["status"] == "accepted"
            ), None)
            return FakeResult({"id": active["id"]} if active else None)
        if sql.startswith("select driver_id from ibook_driver_profiles") and "for update" in sql:
            return FakeResult({"driver_id": str(parameters[0])})
        if sql.startswith("update ibook_driver_profiles set available"):
            if "set available = false" in sql:
                available, driver_id = False, parameters[0]
            elif "set available = true" in sql:
                available, driver_id = True, parameters[0]
            else:
                available, driver_id = parameters
            profile = self.state["drivers"].get(str(driver_id))
            if profile:
                profile["available"] = available
            return FakeResult()
        if sql.startswith("update ibook_ride_requests set status ="):
            status, ride_id = parameters
            ride = self.state["rides"][str(ride_id)]
            ride["status"] = status
            return FakeResult()
        raise AssertionError("Unexpected iBook query: {}".format(query))

    def _stay_row(self, listing):
        host = self.state["users"][listing["host_id"]]
        return {
            **listing, "host_name": host["display_name"], "host_username": host["username"],
        }


class FakeIbookPool:
    def __init__(self, users):
        self.state = {
            "users": {user_id: {
                "id": user_id, "email": username + "@example.com",
                "display_name": username.title(), "username": username,
            } for user_id, username in users.items()},
            "sessions": {}, "stays": {}, "stay_bookings": {}, "drivers": {}, "rides": {},
        }

    @contextmanager
    def connection(self):
        yield FakeIbookConnection(self.state)


class IBookFlowTests(unittest.TestCase):
    def setUp(self):
        self.host_id = str(uuid4())
        self.guest_id = str(uuid4())
        self.driver_id = str(uuid4())
        self.users = {
            self.host_id: "host",
            self.guest_id: "guest",
            self.driver_id: "driver",
        }
        self.pool = FakeIbookPool(self.users)
        self.settings = Settings(
            app_origin="http://localhost:5173",
            api_host="127.0.0.1",
            api_port=10000,
            database_url="postgresql://localhost/test",
            email_from="",
            environment="development",
            otp_hash_secret="test-otp-secret-that-is-long-enough",
            production=False,
            resend_api_key="",
            session_max_age_days=7,
            session_secret="test-session-secret-that-is-long-enough",
            trust_proxy=0,
            admin_emails=frozenset(),
        )
        self.app = create_app(settings=self.settings, pool=self.pool)
        self.clients = {}
        for user_id, username in self.users.items():
            client = TestClient(self.app)
            token = "{}-session".format(username)
            self.pool.state["sessions"][hash_session_token(token, self.settings.session_secret)] = {
                "user_id": user_id,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            }
            client.cookies.set("iconnect.sid", token)
            self.clients[username] = client

    def test_host_lists_stay_guest_requests_and_host_confirms(self):
        created = self.clients["host"].post("/api/ibook/stays", json={
            "property_type": "Apartment",
            "title": "Sunny city apartment",
            "location": "Lagos",
            "price": 45000,
            "price_unit": "night",
            "max_guests": 3,
            "description": "A comfortable, furnished apartment close to restaurants and transport.",
            "image_urls": ["https://images.example.com/stay.jpg"],
        })
        self.assertEqual(created.status_code, 201, created.text)
        stay = created.json()["stay"]
        listed = self.clients["guest"].get("/api/ibook/stays?location=Lagos")
        self.assertEqual(len(listed.json()["stays"]), 1)

        request = self.clients["guest"].post("/api/ibook/stay-bookings", json={
            "listing_id": stay["id"],
            "check_in": (date.today() + timedelta(days=7)).isoformat(),
            "check_out": (date.today() + timedelta(days=10)).isoformat(),
            "guests": 2,
            "message": "I would like to book these dates.",
        })
        self.assertEqual(request.status_code, 201, request.text)
        booking_id = request.json()["bookingId"]
        confirmed = self.clients["host"].post(
            "/api/ibook/stay-bookings/{}/status".format(booking_id),
            json={"status": "confirmed"},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(
            self.clients["guest"].get("/api/ibook/stay-bookings").json()["bookings"][0]["status"],
            "confirmed",
        )

    def test_driver_goes_online_and_accepts_a_ride_request(self):
        saved = self.clients["driver"].put("/api/ibook/drivers/me", json={
            "vehicle_type": "Car",
            "vehicle_description": "Blue sedan",
            "service_area": "Ikeja, Lagos",
            "seats": 3,
            "available": True,
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        available = self.clients["guest"].get("/api/ibook/drivers?area=Ikeja&passengers=2")
        self.assertEqual(len(available.json()["drivers"]), 1)
        request = self.clients["guest"].post("/api/ibook/rides", json={
            "driver_id": self.driver_id,
            "pickup": "Ikeja City Mall",
            "destination": "Murtala Muhammed Airport",
            "pickup_time": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
            "passengers": 2,
            "note": "I have one suitcase.",
        })
        self.assertEqual(request.status_code, 201, request.text)
        ride_id = request.json()["rideId"]
        accepted = self.clients["driver"].post(
            "/api/ibook/rides/{}/status".format(ride_id),
            json={"status": "accepted"},
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(
            self.clients["guest"].get("/api/ibook/rides").json()["rides"][0]["status"],
            "accepted",
        )
        unavailable = self.clients["guest"].get("/api/ibook/drivers?area=Ikeja")
        self.assertEqual(unavailable.json()["drivers"], [])


if __name__ == "__main__":
    unittest.main()
