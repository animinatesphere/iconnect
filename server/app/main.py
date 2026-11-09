import asyncio
import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Deque, Dict, List, Literal, Optional, Tuple
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4
from fastapi import Depends, FastAPI, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import Settings, load_settings
from .billing import (
    BillingProviderError,
    parse_provider_datetime,
    provider_request,
    verify_paystack_signature,
    verify_stripe_signature,
)
from .security import (
    create_email_code,
    create_session_token,
    hash_email_code,
    hash_password,
    hash_session_token,
    secure_hash_equals,
    verify_password,
)
from .job_sources import fetch_external_jobs
from .trading import register_trading_routes
from .deriv import DerivAccount, DerivMarketData
from .geo import SUPPORTED_CURRENCIES, normalize_country, plan_visible_in_country, resolve_country


LOGGER = logging.getLogger("iconnect.api")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9._]{3,30}$")
MAX_REQUEST_BYTES = 16 * 1024
MAX_WEBHOOK_BYTES = 1024 * 1024
AUTH_WINDOW_SECONDS = 15 * 60
AUTH_REQUEST_LIMIT = 10
SOCIAL_WINDOW_SECONDS = 15 * 60
SOCIAL_REQUEST_LIMIT = 60
MESSAGE_WINDOW_SECONDS = 15 * 60
MESSAGE_REQUEST_LIMIT = 120
AI_WINDOW_SECONDS = 15 * 60
AI_REQUEST_LIMIT = 20
MEDIA_UPLOAD_WINDOW_SECONDS = 15 * 60
MEDIA_UPLOAD_REQUEST_LIMIT = 30
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_VOICE_NOTE_BYTES = 10 * 1024 * 1024
MAX_BUSINESS_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 250 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_IMAGES_PER_RECORD = 5
DEFAULT_MEDIA_DIRECTORY = Path(__file__).resolve().parents[2] / "uploads"
MIGRATION_PATH = Path(__file__).resolve().parents[1] / "migrations" / "001_initial.sql"


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class RegisterInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class LoginInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class VerifyInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    code: str = Field(pattern=r"^\d{6}$")

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class ResendInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class ProfileInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=30)
    bio: str = Field(max_length=120)
    interests: List[str]

    @field_validator("name", "bio")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("name")
    @classmethod
    def require_name(cls, value: str) -> str:
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        value = value.strip()
        if not USERNAME_PATTERN.fullmatch(value):
            raise ValueError("Username is invalid.")
        return value

    @field_validator("interests")
    @classmethod
    def valid_interests(cls, values: List[str]) -> List[str]:
        if len(values) > 10:
            raise ValueError("Choose no more than 10 interests.")
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 32 for value in cleaned):
            raise ValueError("Interest length is invalid.")
        return cleaned


class ProfilePhotoInput(StrictModel):
    image_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_image_reference(value)


class SocialPostInput(StrictModel):
    text: str = Field(min_length=1, max_length=500)
    image_urls: List[str] = Field(default_factory=list, max_length=MAX_IMAGES_PER_RECORD)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Post text is required.")
        return value

    @field_validator("image_urls")
    @classmethod
    def valid_image_urls(cls, values: List[str]) -> List[str]:
        return validate_image_urls(values)


class SocialCommentInput(StrictModel):
    text: str = Field(min_length=1, max_length=280)
    parent_comment_id: Optional[UUID] = None

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Comment text is required.")
        return value

    @field_validator("parent_comment_id", mode="before")
    @classmethod
    def parse_parent_comment_id(cls, value: Any) -> Optional[UUID]:
        if value is None or isinstance(value, UUID):
            return value
        if not isinstance(value, str):
            raise ValueError("Parent comment id is invalid.")
        try:
            return UUID(value)
        except ValueError as error:
            raise ValueError("Parent comment id is invalid.") from error


class SocialLikeInput(StrictModel):
    liked: bool


class SocialBookmarkInput(StrictModel):
    bookmarked: bool


class UserStatusInput(StrictModel):
    image_url: str = Field(min_length=1, max_length=2048)
    caption: str = Field(default="", max_length=500)

    @field_validator("image_url")
    @classmethod
    def valid_status_image(cls, value: str) -> str:
        return validate_image_reference(value)

    @field_validator("caption")
    @classmethod
    def clean_status_caption(cls, value: str) -> str:
        return value.strip()


class SavingsPlanInput(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    target_amount: int = Field(ge=1, le=1_000_000_000_000)
    contribution_amount: int = Field(ge=1, le=1_000_000_000)
    frequency: Literal["daily", "weekly", "monthly"]
    target_date: Optional[date] = None

    @field_validator("target_date", mode="before")
    @classmethod
    def parse_target_date(cls, value: Any) -> Optional[date]:
        if value is None or isinstance(value, date):
            return value
        if not isinstance(value, str):
            raise ValueError("Target date is invalid.")
        try:
            return date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("Target date is invalid.") from error

    @field_validator("name")
    @classmethod
    def clean_savings_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A savings plan name is required.")
        return value


class SavingsContributionInput(StrictModel):
    amount: int = Field(ge=1, le=1_000_000_000)
    note: str = Field(default="", max_length=240)

    @field_validator("note")
    @classmethod
    def clean_savings_note(cls, value: str) -> str:
        return value.strip()


class DatingProfileInput(StrictModel):
    birth_date: Optional[date] = None
    gender: Literal["woman", "man", "non_binary"]
    seeking: Literal["women", "men", "non_binary", "everyone"]
    location: str = Field(min_length=1, max_length=120)
    bio: str = Field(min_length=1, max_length=500)
    interests: List[str] = Field(default_factory=list, max_length=10)
    image_urls: List[str] = Field(min_length=1, max_length=5)
    active: bool = True
    agree_to_adult_terms: bool

    @field_validator("birth_date", mode="before")
    @classmethod
    def parse_birth_date(cls, value: Any) -> Optional[date]:
        if value is None or isinstance(value, date):
            return value
        if not isinstance(value, str):
            raise ValueError("Date of birth is invalid.")
        try:
            return date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("Date of birth is invalid.") from error

    @field_validator("location", "bio")
    @classmethod
    def clean_dating_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Location and bio are required.")
        return value

    @field_validator("interests")
    @classmethod
    def clean_dating_interests(cls, values: List[str]) -> List[str]:
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 40 for value in cleaned):
            raise ValueError("Dating interests must be 1–40 characters.")
        if len({value.casefold() for value in cleaned}) != len(cleaned):
            raise ValueError("Dating interests must be unique.")
        return cleaned

    @field_validator("image_urls")
    @classmethod
    def validate_dating_images(cls, values: List[str]) -> List[str]:
        return validate_image_urls(values)


class DatingLikeInput(StrictModel):
    liked: bool


class DatingMessageInput(StrictModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def clean_dating_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A message is required.")
        return value


class DatingReportInput(StrictModel):
    reason: Literal["inappropriate", "fake_profile", "harassment", "other"]
    details: str = Field(default="", max_length=1000)

    @field_validator("details")
    @classmethod
    def clean_dating_report_details(cls, value: str) -> str:
        return value.strip()


class MarketplaceProductInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    category: Literal["Style", "Tech", "Home", "Other"]
    price: int = Field(ge=1, le=1_000_000_000)
    stock: int = Field(ge=0, le=1_000_000)
    description: str = Field(min_length=1, max_length=2000)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    image_urls: List[str] = Field(default_factory=list, max_length=MAX_IMAGES_PER_RECORD)

    @field_validator("name", "description")
    @classmethod
    def clean_listing_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Product name and description are required.")
        return value

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Product images must use an https URL.")
        return value

    @field_validator("image_urls")
    @classmethod
    def valid_image_urls(cls, values: List[str]) -> List[str]:
        return validate_image_urls(values)


class MarketplaceCheckoutInput(StrictModel):
    product_id: UUID = Field(strict=False)
    quantity: int = Field(ge=1, le=1000)


class AdminMarketplaceProductInput(MarketplaceProductInput):
    published: bool = True


class AdminSubadminInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Email is invalid.")
        return value


class AdminUserStatusInput(StrictModel):
    suspended: bool


def validate_image_urls(values: List[str]) -> List[str]:
    if len(values) > MAX_IMAGES_PER_RECORD:
        raise ValueError("Choose no more than five images.")
    cleaned = []
    for value in values:
        cleaned.append(validate_image_reference(value))
    if len(set(cleaned)) != len(cleaned):
        raise ValueError("Image URLs must be unique.")
    return cleaned


def validate_image_reference(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 2048:
        raise ValueError("Image URL is invalid.")
    if value.startswith("/api/media/images/"):
        filename = value.rsplit("/", 1)[-1]
        if not re.fullmatch(r"[a-f0-9]{32}\.webp", filename):
            raise ValueError("Uploaded image URL is invalid.")
    else:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Images must use an uploaded image or https URL.")
    return value


class LocalMarketplaceListingInput(StrictModel):
    category: Literal["Homes", "Services", "Farm"]
    title: str = Field(min_length=1, max_length=120)
    price: str = Field(min_length=1, max_length=80)
    location: str = Field(min_length=1, max_length=120)
    detail: str = Field(min_length=1, max_length=280)
    description: str = Field(min_length=1, max_length=2000)
    image_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("title", "price", "location", "detail", "description")
    @classmethod
    def clean_listing_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Listing details are required.")
        return value

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        return validate_image_reference(value)


class IBookStayInput(StrictModel):
    property_type: Literal["Apartment", "House", "Room", "Vacation rental"]
    title: str = Field(min_length=4, max_length=120)
    location: str = Field(min_length=2, max_length=120)
    price: int = Field(gt=0, le=1000000000)
    price_unit: Literal["night", "month"]
    max_guests: int = Field(ge=1, le=30)
    description: str = Field(min_length=20, max_length=2000)
    image_urls: List[str] = Field(min_length=1, max_length=5)

    @field_validator("title", "location", "description")
    @classmethod
    def clean_ibook_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required.")
        return value

    @field_validator("image_urls")
    @classmethod
    def validate_ibook_images(cls, values: List[str]) -> List[str]:
        if not values:
            raise ValueError("Upload at least one property photo.")
        return [validate_image_reference(value) for value in values]


class IBookStayBookingInput(StrictModel):
    listing_id: UUID = Field(strict=False)
    check_in: date = Field(strict=False)
    check_out: date = Field(strict=False)
    guests: int = Field(ge=1, le=30)
    message: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_stay_dates(self) -> "IBookStayBookingInput":
        if self.check_out <= self.check_in:
            raise ValueError("Check-out must be after check-in.")
        if self.check_in < date.today():
            raise ValueError("Check-in cannot be in the past.")
        return self


class IBookDriverInput(StrictModel):
    vehicle_type: Literal["Car", "Motorcycle", "Tricycle"]
    vehicle_description: str = Field(min_length=2, max_length=100)
    service_area: str = Field(min_length=2, max_length=120)
    seats: int = Field(ge=1, le=8)
    available: bool = True

    @field_validator("vehicle_description", "service_area")
    @classmethod
    def clean_driver_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required.")
        return value


class IBookRideInput(StrictModel):
    driver_id: UUID = Field(strict=False)
    pickup: str = Field(min_length=2, max_length=180)
    destination: str = Field(min_length=2, max_length=180)
    pickup_time: datetime = Field(strict=False)
    passengers: int = Field(ge=1, le=8)
    note: str = Field(default="", max_length=500)

    @field_validator("pickup", "destination")
    @classmethod
    def clean_ride_location(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Pickup and destination are required.")
        return value

    @model_validator(mode="after")
    def validate_route(self) -> "IBookRideInput":
        if self.pickup.casefold() == self.destination.casefold():
            raise ValueError("Pickup and destination must be different.")
        return self

    @field_validator("pickup_time")
    @classmethod
    def validate_pickup_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Pickup time must include a timezone.")
        if value < datetime.now(timezone.utc) - timedelta(minutes=2):
            raise ValueError("Pickup time cannot be in the past.")
        return value


class IBookStatusInput(StrictModel):
    status: Literal["confirmed", "declined", "cancelled", "accepted", "completed"]


class CommunityInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    rules: str = Field(default="", max_length=2000)
    members_can_post: bool = True
    membership_mode: Literal["open", "approval"] = "open"

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_image_reference(value)

    @field_validator("name", "description")
    @classmethod
    def clean_community_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Community name and description are required.")
        return value

    @field_validator("rules")
    @classmethod
    def clean_community_rules(cls, value: str) -> str:
        return value.strip()


class CommunityMembershipInput(StrictModel):
    joined: bool


class CommunityJoinRequestInput(StrictModel):
    approved: bool


class DirectConversationInput(StrictModel):
    recipient_id: UUID

    @field_validator("recipient_id", mode="before")
    @classmethod
    def parse_recipient_id(cls, value: Any) -> UUID:
        if isinstance(value, UUID):
            return value
        if not isinstance(value, str):
            raise ValueError("Recipient id is invalid.")
        try:
            return UUID(value)
        except ValueError as error:
            raise ValueError("Recipient id is invalid.") from error


class DirectConversationBlockInput(StrictModel):
    blocked: bool


class DirectConversationPreferencesInput(StrictModel):
    is_muted: bool
    is_archived: bool


class DirectMessageInput(StrictModel):
    text: Optional[str] = Field(default=None, max_length=2000)
    image_url: Optional[str] = Field(default=None, max_length=2048)
    audio_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if value and value.strip() else None

    @field_validator("image_url")
    @classmethod
    def valid_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_image_reference(value)

    @field_validator("audio_url")
    @classmethod
    def valid_audio_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not re.fullmatch(r"/api/media/voice-notes/[a-f0-9]{32}\.(webm|ogg|mp4)", value):
            raise ValueError("Voice note reference is invalid.")
        return value

    @model_validator(mode="after")
    def require_message_content(self) -> "DirectMessageInput":
        if not self.text and not self.image_url and not self.audio_url:
            raise ValueError("Add a message, photo, or voice note.")
        if self.image_url and self.audio_url:
            raise ValueError("Send a photo or a voice note, not both.")
        return self


class DirectMessageEditInput(StrictModel):
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def clean_edit_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message text is required.")
        return value


class LiveStreamInput(StrictModel):
    title: str = Field(min_length=1, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_live_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A live title is required.")
        return value


class AssistantMessageInput(StrictModel):
    role: Literal["user", "model"]
    text: str = Field(min_length=1, max_length=4000)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message text is required.")
        return value


class AssistantChatInput(StrictModel):
    messages: List[AssistantMessageInput] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_conversation(self) -> "AssistantChatInput":
        if self.messages[-1].role != "user":
            raise ValueError("The latest assistant message must come from the user.")
        if any(left.role == right.role for left, right in zip(self.messages, self.messages[1:])):
            raise ValueError("Conversation messages must alternate between user and assistant.")
        if sum(len(message.text) for message in self.messages) > 12000:
            raise ValueError("The conversation is too long.")
        return self


class SubscriptionPlanInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    currency: str = Field(min_length=3, max_length=3)
    country_codes: List[str] = Field(default_factory=list, max_length=250)
    amount_minor: int = Field(ge=1, le=100_000_000_000)
    jobs_limit: int = Field(ge=0, le=10000)
    products_limit: int = Field(ge=0, le=10000)
    marketplace_limit: int = Field(ge=0, le=10000)
    videos_limit: int = Field(ge=0, le=10000)
    active: bool = True

    @field_validator("name")
    @classmethod
    def clean_plan_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A plan name is required.")
        return value

    @field_validator("currency")
    @classmethod
    def supported_plan_currency(cls, value: str) -> str:
        value = value.strip().upper()
        if value not in SUPPORTED_CURRENCIES:
            raise ValueError("Unsupported currency.")
        return value

    @field_validator("country_codes")
    @classmethod
    def clean_country_codes(cls, values: List[str]) -> List[str]:
        cleaned: List[str] = []
        for value in values:
            code = normalize_country(value)
            if not code:
                raise ValueError("Use two-letter country codes such as US, GB or CA.")
            if code not in cleaned:
                cleaned.append(code)
        return cleaned


class PostingQuotaSettingsInput(StrictModel):
    free_jobs_limit: int = Field(ge=0, le=1000)
    free_products_limit: int = Field(ge=0, le=1000)
    free_marketplace_limit: int = Field(ge=0, le=1000)
    free_videos_limit: int = Field(ge=0, le=1000)
    free_daily_dating_likes: int = Field(ge=0, le=1000)
    marketplace_commission_bps: int = Field(ge=0, le=3000)


class DatingBillingProductInput(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    amount_minor: int = Field(ge=0, le=100_000_000_000)
    quantity: int = Field(ge=1, le=1000)
    duration_hours: int = Field(ge=0, le=720)
    active: bool

    @field_validator("name")
    @classmethod
    def clean_dating_product_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A product name is required.")
        return value


class BillingCheckoutInput(StrictModel):
    plan_id: Optional[UUID] = Field(default=None, strict=False)
    dating_product_id: Optional[UUID] = Field(default=None, strict=False)

    @model_validator(mode="after")
    def validate_checkout_item(self) -> "BillingCheckoutInput":
        if (self.plan_id is None) == (self.dating_product_id is None):
            raise ValueError("Choose exactly one plan or dating add-on.")
        return self


class BillingConfirmInput(StrictModel):
    reference: str = Field(min_length=1, max_length=200)


class UserFollowInput(StrictModel):
    following: bool


class PrivacyPreferencesInput(StrictModel):
    profile_visible: bool
    discoverable: bool


class JobListingInput(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    company: str = Field(min_length=1, max_length=120)
    location: str = Field(min_length=1, max_length=120)
    employment_type: str = Field(min_length=1, max_length=40)
    workplace_type: Literal["remote", "hybrid", "onsite"]
    summary: str = Field(min_length=1, max_length=250)
    description: str = Field(min_length=1, max_length=5000)
    company_image_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("company_image_url")
    @classmethod
    def valid_company_image_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_image_reference(value)

    @field_validator("title", "company", "location", "employment_type", "summary", "description")
    @classmethod
    def clean_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required.")
        return value


class JobBusinessProfileInput(StrictModel):
    company_name: str = Field(min_length=1, max_length=120)
    registration_number: str = Field(min_length=1, max_length=80)
    business_type: str = Field(min_length=1, max_length=80)
    business_address: str = Field(min_length=1, max_length=240)
    contact_phone: str = Field(min_length=5, max_length=40)
    description: str = Field(min_length=1, max_length=1000)

    @field_validator(
        "company_name",
        "registration_number",
        "business_type",
        "business_address",
        "contact_phone",
        "description",
    )
    @classmethod
    def clean_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required.")
        return value


class JobSaveInput(StrictModel):
    saved: bool


class JobApplicationInput(StrictModel):
    cover_letter: str = Field(default="", max_length=2000)

    @field_validator("cover_letter")
    @classmethod
    def clean_cover_letter(cls, value: str) -> str:
        return value.strip()


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(user["id"]),
        "name": user["display_name"],
        "username": user["username"],
        "image": user.get("profile_image_url"),
        "email": user["email"],
        "bio": user["bio"],
        "interests": user["interests"],
        "profileVisible": user.get("profile_visible", True),
        "discoverable": user.get("discoverable", True),
    }


def public_video(video: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(video["id"]),
        "title": video["title"],
        "caption": video["caption"],
        "url": "/api/videos/{}/stream".format(video["id"]),
        "contentType": video["content_type"],
        "fileSize": video["file_size"],
        "createdAt": video["created_at"].isoformat(),
        "author": {
            "id": str(video["user_id"]),
            "name": video["display_name"],
            "username": video["username"],
            "image": video.get("profile_image_url"),
        },
    }


def live_stream_access_token(
    settings: Settings,
    user_id: Any,
    display_name: str,
    room_name: str,
    can_publish: bool,
) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    claims = {
        "iss": settings.livekit_api_key,
        "sub": str(user_id),
        "name": display_name,
        "nbf": now,
        "exp": now + 6 * 60 * 60,
        "video": {
            "roomJoin": True,
            "room": room_name,
            "canPublish": can_publish,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }

    def encode_part(value: Dict[str, Any]) -> str:
        serialized = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        return base64.urlsafe_b64encode(serialized).rstrip(b"=").decode("ascii")

    unsigned_token = "{}.{}".format(encode_part(header), encode_part(claims))
    signature = hmac.new(
        settings.livekit_api_secret.encode("utf-8"),
        unsigned_token.encode("ascii"),
        hashlib.sha256,
    ).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")
    return "{}.{}".format(unsigned_token, encoded_signature)


def public_live_stream(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "createdAt": row["created_at"].isoformat(),
        "host": {
            "id": str(row["host_id"]),
            "name": row["display_name"],
            "username": row["username"],
            "image": row.get("profile_image_url"),
        },
    }


def public_job_business_profile(
    profile: Optional[Dict[str, Any]],
    document_url: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not profile:
        return None
    return {
        "companyName": profile["company_name"],
        "registrationNumber": profile["registration_number"],
        "businessType": profile["business_type"],
        "businessAddress": profile["business_address"],
        "contactPhone": profile["contact_phone"],
        "description": profile["description"],
        "documentContentType": profile["document_content_type"],
        "documentSize": int(profile["document_size"]),
        "documentUrl": document_url,
        "submittedAt": profile["submitted_at"].isoformat(),
        "updatedAt": profile["updated_at"].isoformat(),
    }


def _send_otp_email(
    email: str,
    name: str,
    code: str,
    settings: Settings,
    logger: logging.Logger,
) -> None:
    if not settings.resend_api_key and not settings.production:
        logger.info("Development email OTP for %s: %s", email, code)
        return
    if not settings.resend_api_key or not settings.email_from:
        raise RuntimeError("Email delivery is not configured.")

    safe_name = html.escape(name)
    email_html = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your iConnect verification code</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4ef;font-family:Arial,Helvetica,sans-serif;color:#292b25;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your iConnect sign-in code is inside. It expires in 10 minutes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4ef;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fffefa;border:1px solid #e8e8df;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:25px 32px;background:#25271f;color:#fffefa;">
            <div style="font-size:21px;font-weight:700;letter-spacing:-.5px;">iConnect<span style="color:#c6d89b;">.</span></div>
            <div style="padding-top:6px;color:#d4d5ca;font-size:12px;">A little more connection.</div>
          </td></tr>
          <tr><td style="padding:34px 32px 18px;">
            <div style="color:#788653;font-size:11px;font-weight:700;letter-spacing:1.5px;">EMAIL VERIFICATION</div>
            <h1 style="margin:12px 0 10px;font-size:25px;line-height:1.25;color:#292b25;">You’re almost home, {name}.</h1>
            <p style="margin:0;color:#66685e;font-size:15px;line-height:1.65;">Enter this one-time code to verify your email and finish setting up your iConnect account.</p>
          </td></tr>
          <tr><td style="padding:10px 32px 18px;">
            <div style="padding:21px 12px;border:1px solid #e5e9d8;border-radius:12px;background:#f5f7ee;text-align:center;">
              <div style="color:#77796e;font-size:10px;font-weight:700;letter-spacing:1.6px;">YOUR VERIFICATION CODE</div>
              <div style="padding-top:10px;color:#34382b;font-size:34px;font-weight:700;letter-spacing:9px;">{code}</div>
            </div>
          </td></tr>
          <tr><td style="padding:0 32px 30px;">
            <p style="margin:0;color:#77796e;font-size:13px;line-height:1.65;"><strong style="color:#494b43;">This code expires in 10 minutes.</strong><br>If you didn’t request it, you can safely ignore this email. Never share your code with anyone.</p>
          </td></tr>
          <tr><td style="padding:18px 32px;border-top:1px solid #eeeee7;background:#fafaf6;color:#85867d;font-size:11px;line-height:1.6;">
            Sent by iConnect to verify your email address.<br>iConnect · Social, made a little more human
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>""".format(name=safe_name, code=html.escape(code))
    payload = json.dumps({
        "from": settings.email_from,
        "to": [email],
        "subject": "Your iConnect verification code",
        "text": "Hi {}, your iConnect verification code is {}. It expires in 10 minutes.".format(name, code),
        "html": email_html,
    }).encode("utf-8")
    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": "Bearer {}".format(settings.resend_api_key),
            "Content-Type": "application/json",
            "User-Agent": "iConnect-API/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if not 200 <= response.status < 300:
                raise RuntimeError("Resend rejected the verification email (HTTP {}).".format(response.status))
    except urllib.error.HTTPError as error:
        raise RuntimeError("Resend rejected the verification email (HTTP {}).".format(error.code)) from error


def create_app(
    settings: Optional[Settings] = None,
    pool: Optional[Any] = None,
    send_otp_email: Optional[Callable[[str, str, str], None]] = None,
    logger: logging.Logger = LOGGER,
    media_directory: Optional[Path] = None,
) -> FastAPI:
    settings = settings or load_settings()
    owns_pool = pool is None
    database = pool or ConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row},
        open=False,
    )
    send_email = send_otp_email or (
        lambda email, name, code: _send_otp_email(email, name, code, settings, logger)
    )
    dummy_password_hash = hash_password("not-a-real-user-password")
    rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    rate_limit_lock = threading.Lock()
    social_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    social_rate_limit_lock = threading.Lock()
    message_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    message_rate_limit_lock = threading.Lock()
    ai_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    ai_rate_limit_lock = threading.Lock()
    media_upload_rate_limit_state: Dict[str, Deque[float]] = defaultdict(deque)
    media_upload_rate_limit_lock = threading.Lock()
    realtime_connections: Dict[
        str,
        Dict[int, Tuple[asyncio.AbstractEventLoop, asyncio.Queue[Dict[str, Any]]]],
    ] = defaultdict(dict)
    realtime_connections_lock = threading.Lock()
    configured_media_directory = media_directory or Path(os.getenv(
        "ICONNECT_MEDIA_DIR",
        str(DEFAULT_MEDIA_DIRECTORY),
    )).expanduser()
    uploads_directory = (
        configured_media_directory
        if configured_media_directory.is_absolute()
        else DEFAULT_MEDIA_DIRECTORY.parent / configured_media_directory
    )
    videos_directory = uploads_directory / "videos"
    business_documents_directory = uploads_directory / "business-documents"
    cookie_name = "__Host-iconnect.sid" if settings.production else "iconnect.sid"

    def publish_realtime(
        event: Dict[str, Any],
        user_ids: Optional[List[Any]] = None,
    ) -> None:
        normalized_user_ids = (
            {str(user_id) for user_id in user_ids}
            if user_ids is not None
            else None
        )
        with realtime_connections_lock:
            if normalized_user_ids is None:
                subscribers = [
                    subscriber
                    for user_subscribers in realtime_connections.values()
                    for subscriber in user_subscribers.values()
                ]
            else:
                subscribers = [
                    subscriber
                    for user_id in normalized_user_ids
                    for subscriber in realtime_connections.get(user_id, {}).values()
                ]
        for loop, queue in subscribers:
            def enqueue_event(target_queue: asyncio.Queue, payload: Dict[str, Any]) -> None:
                if target_queue.full():
                    while not target_queue.empty():
                        target_queue.get_nowait()
                    target_queue.put_nowait({"type": "sync"})
                else:
                    target_queue.put_nowait(payload)

            try:
                loop.call_soon_threadsafe(enqueue_event, queue, event)
            except RuntimeError:
                continue

    def register_realtime_connection(
        user_id: Any,
        connection_id: int,
        loop: asyncio.AbstractEventLoop,
        queue: asyncio.Queue[Dict[str, Any]],
    ) -> None:
        with realtime_connections_lock:
            realtime_connections[str(user_id)][connection_id] = (loop, queue)

    def unregister_realtime_connection(user_id: Any, connection_id: int) -> None:
        with realtime_connections_lock:
            user_subscribers = realtime_connections.get(str(user_id))
            if user_subscribers:
                user_subscribers.pop(connection_id, None)
                if not user_subscribers:
                    realtime_connections.pop(str(user_id), None)

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        if owns_pool:
            database.open()
            try:
                migration_sql = MIGRATION_PATH.read_text(encoding="utf-8")
                with database.connection() as connection:
                    connection.execute(migration_sql.encode("utf-8"), prepare=False)
                    connection.execute("SELECT 1")
            except Exception:
                database.close()
                raise
        yield
        if owns_pool:
            database.close()

    app = FastAPI(
        title="iConnect API",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": error.code, "message": error.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid_input", "message": "Check the information and try again."}},
        )

    @app.exception_handler(Exception)
    async def internal_error_handler(_request: Request, error: Exception) -> JSONResponse:
        logger.exception("API request failed: %s", error)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "The request could not be completed. Try again later.",
                },
            },
        )

    @app.middleware("http")
    async def apply_security_headers(request: Request, call_next: Callable[..., Any]) -> Response:
        origin = request.headers.get("origin")
        allowed_origins = {settings.app_origin}
        if not settings.production:
            allowed_origins.update({
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            })
        if origin and origin not in allowed_origins:
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "origin_not_allowed", "message": "This request origin is not allowed."}},
            )
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                body_limit = (
                    MAX_IMAGE_BYTES
                    if request.url.path == "/api/media/images"
                    else MAX_WEBHOOK_BYTES
                    if request.url.path in {
                        "/api/billing/webhooks/paystack",
                        "/api/billing/webhooks/stripe",
                    }
                    else MAX_VOICE_NOTE_BYTES
                    if request.url.path == "/api/media/voice-notes"
                    else MAX_BUSINESS_DOCUMENT_BYTES
                    if request.url.path == "/api/jobs/business-profile"
                    else MAX_VIDEO_BYTES
                    if request.url.path == "/api/videos"
                    else MAX_REQUEST_BYTES
                )
                if int(content_length) > body_limit:
                    return JSONResponse(
                        status_code=413,
                        content={"error": {"code": "request_too_large", "message": "The request body is too large."}},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"error": {"code": "invalid_input", "message": "Check the information and try again."}},
                )
        response = await call_next(request)
        if "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if settings.production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        return response

    def enforce_auth_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with rate_limit_lock:
            attempts = rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= AUTH_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= AUTH_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "Too many authentication attempts. Try again in 15 minutes.",
                )
            attempts.append(now)

    def enforce_social_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with social_rate_limit_lock:
            attempts = social_rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= SOCIAL_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= SOCIAL_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "You are posting too quickly. Please try again later.",
                )
            attempts.append(now)

    def enforce_message_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with message_rate_limit_lock:
            attempts = message_rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= MESSAGE_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= MESSAGE_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "You are sending messages too quickly. Please try again later.",
                )
            attempts.append(now)

    def enforce_ai_rate_limit(user_id: Any) -> None:
        now = time.monotonic()
        with ai_rate_limit_lock:
            attempts = ai_rate_limit_state[str(user_id)]
            while attempts and now - attempts[0] >= AI_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= AI_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "You’ve reached the assistant request limit. Try again in a few minutes.",
                )
            attempts.append(now)

    def posting_quota_snapshot(
        connection: Any,
        user_id: Any,
        category: str,
        lock: bool = False,
    ) -> Dict[str, int]:
        if lock:
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))",
                (str(user_id), category),
            )
        settings_row = connection.execute(
            """SELECT free_monthly_limits
               FROM posting_quota_settings WHERE id = 1"""
        ).fetchone()
        if not settings_row:
            raise ApiError(
                503,
                "billing_not_configured",
                "Posting limits are unavailable. Please try again later.",
            )
        subscription = connection.execute(
            """SELECT plan.posting_limits
               FROM billing_subscriptions subscription
               JOIN subscription_plans plan ON plan.id = subscription.plan_id
               WHERE subscription.user_id = %s
                 AND subscription.status IN ('active', 'past_due')
                 AND (subscription.current_period_end IS NULL
                      OR subscription.current_period_end > now())
               ORDER BY subscription.current_period_end DESC NULLS LAST,
                        subscription.created_at DESC
               LIMIT 1""",
            (user_id,),
        ).fetchone()
        active_plan_limits = subscription.get("posting_limits") if subscription else None
        limits = (
            active_plan_limits
            if subscription
            else settings_row.get("free_monthly_limits")
        ) or {}
        if isinstance(limits, str):
            try:
                limits = json.loads(limits)
            except json.JSONDecodeError as error:
                logger.exception("Stored posting quota settings contain invalid JSON.")
                raise ApiError(500, "billing_configuration_error", "Posting limits could not be loaded.") from error
        monthly_limit = limits.get(category, 0) if isinstance(limits, dict) else 0
        try:
            monthly_limit = max(0, int(monthly_limit))
        except (TypeError, ValueError):
            raise ApiError(500, "billing_configuration_error", "Posting limits could not be loaded.")
        usage_row = connection.execute(
            """SELECT count(*) AS used
               FROM posting_usage
               WHERE user_id = %s AND category = %s
                 AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')""",
            (user_id, category),
        ).fetchone()
        used = int(usage_row["used"]) if usage_row else 0
        return {
            "limit": monthly_limit,
            "used": used,
            "remaining": max(0, monthly_limit - used),
        }

    def record_posting_usage(
        connection: Any,
        user_id: Any,
        category: str,
        content_id: Any,
    ) -> None:
        quota = posting_quota_snapshot(connection, user_id, category, lock=True)
        if quota["used"] >= quota["limit"]:
            label = {
                "jobs": "job",
                "products": "product",
                "marketplace": "marketplace listing",
                "videos": "video",
            }[category]
            raise ApiError(
                402,
                "posting_limit_reached",
                "Your monthly {} posting allowance is used up. Choose a publisher plan to continue.".format(label),
            )
        connection.execute(
            """INSERT INTO posting_usage (user_id, category, content_id)
               VALUES (%s, %s, %s)""",
            (user_id, category, content_id),
        )

    def enforce_media_upload_rate_limit(request: Request) -> None:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = (
            forwarded_for.split(",")[0].strip()
            if settings.trust_proxy and forwarded_for
            else request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        with media_upload_rate_limit_lock:
            attempts = media_upload_rate_limit_state[client_ip]
            while attempts and now - attempts[0] >= MEDIA_UPLOAD_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= MEDIA_UPLOAD_REQUEST_LIMIT:
                raise ApiError(
                    429,
                    "rate_limited",
                    "Too many image uploads. Please try again later.",
                )
            attempts.append(now)

    def social_post(connection: Any, post_id: Any, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT p.id, p.body, p.image_urls, p.created_at,
                      u.id AS author_id, u.display_name, u.username,
                      u.profile_image_url AS author_image_url,
                      (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                      (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count,
                      EXISTS (
                          SELECT 1 FROM social_post_likes mine
                          WHERE mine.post_id = p.id AND mine.user_id = %s
                      ) AS liked_by_me,
                      EXISTS (
                          SELECT 1 FROM social_post_bookmarks mine
                          WHERE mine.post_id = p.id AND mine.user_id = %s
                      ) AS bookmarked_by_me
               FROM social_posts p
               JOIN users u ON u.id = p.user_id
               WHERE p.id = %s""",
            (viewer_id, viewer_id, post_id),
        ).fetchone()

    def public_social_post(row: Dict[str, Any], viewer_id: Any) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "imageUrls": row.get("image_urls") or [],
            "createdAt": row["created_at"].isoformat(),
            "isMine": str(row["author_id"]) == str(viewer_id),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
                "image": row.get("author_image_url"),
            },
            "likeCount": int(row["like_count"]),
            "commentCount": int(row["comment_count"]),
            "likedByMe": bool(row["liked_by_me"]),
            "bookmarkedByMe": bool(row["bookmarked_by_me"]),
        }

    def public_social_comment(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "createdAt": row["created_at"].isoformat(),
            "parentCommentId": (
                str(row["parent_comment_id"])
                if row.get("parent_comment_id")
                else None
            ),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
                "image": row.get("author_image_url"),
            },
        }

    def public_marketplace_product(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "category": row["category"],
            "price": int(row["price"]),
            "stock": int(row["stock"]),
            "description": row["description"],
            "imageUrl": (row.get("image_urls") or [row["image_url"]])[0],
            "imageUrls": row.get("image_urls") or ([row["image_url"]] if row["image_url"] else []),
            "createdAt": row["created_at"].isoformat(),
            "seller": {
                "id": str(row["seller_id"]),
                "name": row["seller_name"],
                "username": row["seller_username"],
            },
        }

    def public_marketplace_order(row: Dict[str, Any], viewer_id: Any) -> Dict[str, Any]:
        viewer_is_buyer = str(row["buyer_id"]) == str(viewer_id)
        other_user = (
            {
                "id": str(row["seller_id"]),
                "name": row["seller_name"],
                "username": row["seller_username"],
            }
            if viewer_is_buyer
            else {
                "id": str(row["buyer_id"]),
                "name": row["buyer_name"],
                "username": row["buyer_username"],
            }
        )
        return {
            "id": str(row["id"]),
            "productId": str(row["product_id"]),
            "productName": row["product_name"],
            "quantity": int(row["quantity"]),
            "unitPriceMinor": int(row["unit_price_minor"]),
            "amountMinor": int(row["amount_minor"]),
            "marketplaceCommissionMinor": int(row["marketplace_commission_minor"]),
            "sellerAmountMinor": int(row["seller_amount_minor"]),
            "currency": row["currency"],
            "status": row["status"],
            "createdAt": row["created_at"].isoformat(),
            "paidAt": row["paid_at"].isoformat() if row.get("paid_at") else None,
            "fulfilledAt": row["fulfilled_at"].isoformat() if row.get("fulfilled_at") else None,
            "role": "buyer" if viewer_is_buyer else "seller",
            "otherParty": other_user,
        }

    def public_status(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "imageUrl": row["image_url"],
            "caption": row["caption"],
            "createdAt": row["created_at"].isoformat(),
            "expiresAt": row["expires_at"].isoformat(),
            "viewedByMe": bool(row.get("viewed_by_me")),
            "isMine": bool(row["is_mine"]),
            "viewCount": int(row.get("view_count") or 0),
            "author": {
                "id": str(row["user_id"]),
                "name": row["display_name"],
                "username": row["username"],
                "avatar": row.get("profile_image_url"),
            },
            "viewers": row.get("viewers", []),
        }

    def public_local_marketplace_listing(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "category": row["category"],
            "title": row["title"],
            "price": row["price"],
            "location": row["location"],
            "detail": row["detail"],
            "description": row["description"],
            "imageUrl": row["image_url"],
            "createdAt": row["created_at"].isoformat(),
            "seller": {
                "id": str(row["seller_id"]),
                "name": row["seller_name"],
                "username": row["seller_username"],
            },
        }

    def public_community(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "memberCount": int(row["member_count"]),
            "joinedByMe": bool(row["joined_by_me"]),
            "createdAt": row["created_at"].isoformat(),
            "imageUrl": row.get("image_url"),
            "ownerId": str(row["owner_id"]) if row.get("owner_id") else None,
            "ownerName": row.get("owner_name"),
            "ownerUsername": row.get("owner_username"),
            "rules": row.get("rules") or "",
            "membersCanPost": bool(row.get("members_can_post", True)),
            "membershipMode": row.get("membership_mode", "open"),
            "isAdmin": bool(row.get("is_admin", False)),
            "joinRequestedByMe": bool(row.get("join_requested_by_me", False)),
            "pendingRequestCount": int(row.get("pending_request_count", 0)),
        }

    def community_record(connection: Any, community_id: UUID, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT c.id, c.owner_id, c.name, c.description, c.image_url,
                      c.rules, c.members_can_post, c.membership_mode, c.created_at,
                      owner.display_name AS owner_name,
                      owner.username AS owner_username,
                      (SELECT count(*) FROM community_memberships members
                       WHERE members.community_id = c.id) AS member_count,
                      (SELECT count(*) FROM community_join_requests requests
                       WHERE requests.community_id = c.id AND requests.status = 'pending')
                         AS pending_request_count,
                      EXISTS (
                          SELECT 1 FROM community_memberships mine
                          WHERE mine.community_id = c.id AND mine.user_id = %s
                      ) AS joined_by_me,
                      EXISTS (
                          SELECT 1 FROM community_join_requests mine_request
                          WHERE mine_request.community_id = c.id
                            AND mine_request.user_id = %s
                            AND mine_request.status = 'pending'
                      ) AS join_requested_by_me,
                      c.owner_id = %s AS is_admin
               FROM communities c
               JOIN users owner ON owner.id = c.owner_id
               WHERE c.id = %s""",
            (viewer_id, viewer_id, viewer_id, community_id),
        ).fetchone()

    def require_community_member(connection: Any, community_id: UUID, user_id: Any) -> Dict[str, Any]:
        community = connection.execute(
            """SELECT c.owner_id, c.members_can_post,
                      EXISTS (
                          SELECT 1 FROM community_memberships membership
                          WHERE membership.community_id = c.id AND membership.user_id = %s
                      ) AS joined_by_me
               FROM communities c
               WHERE c.id = %s""",
            (user_id, community_id),
        ).fetchone()
        if not community:
            raise ApiError(404, "community_not_found", "That community could not be found.")
        if not community["joined_by_me"] and str(community["owner_id"]) != str(user_id):
            raise ApiError(403, "community_membership_required", "Join this community to view its member space.")
        return community

    def public_community_post(row: Dict[str, Any], viewer_id: Any, owner_id: Any) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": row["body"],
            "imageUrls": row.get("image_urls") or [],
            "createdAt": row["created_at"].isoformat(),
            "isMine": str(row["author_id"]) == str(viewer_id),
            "canDelete": (
                str(row["author_id"]) == str(viewer_id)
                or str(owner_id) == str(viewer_id)
            ),
            "author": {
                "id": str(row["author_id"]),
                "name": row["display_name"],
                "username": row["username"],
                "image": row.get("author_image_url"),
            },
        }

    def public_direct_message(row: Dict[str, Any], viewer_id: Any) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "text": "" if row.get("image_url") and row["body"] == "Photo" else row["body"],
            "imageUrl": row.get("image_url"),
            "audioUrl": row.get("audio_url"),
            "createdAt": row["created_at"].isoformat(),
            "readAt": row["read_at"].isoformat() if row.get("read_at") else None,
            "isMine": str(row["sender_id"]) == str(viewer_id),
            "editedAt": row["edited_at"].isoformat() if row.get("edited_at") else None,
            "canEdit": (
                str(row["sender_id"]) == str(viewer_id)
                and not row.get("image_url")
                and not row.get("audio_url")
            ),
            "sender": {
                "id": str(row["sender_id"]),
                "name": row["display_name"],
                "username": row["username"],
            },
        }

    def public_discoverable_user(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "name": row["display_name"],
            "username": row["username"],
            "bio": row["bio"],
            "interests": row["interests"],
            "avatar": row.get("profile_image_url"),
            "followerCount": int(row["follower_count"]),
            "followingCount": int(row["following_count"]),
            "followedByMe": bool(row["followed_by_me"]),
        }

    def public_job(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "title": row["title"],
            "company": row["company"],
            "companyImageUrl": row.get("company_image_url"),
            "location": row["location"],
            "employmentType": row["employment_type"],
            "workplaceType": row["workplace_type"],
            "summary": row["summary"],
            "description": row["description"],
            "createdAt": row["created_at"].isoformat(),
            "poster": {
                "name": row["display_name"],
                "username": row["username"],
            },
            "isSaved": bool(row["is_saved"]),
            "appliedByMe": bool(row["applied_by_me"]),
            "isOwner": bool(row["is_owner"]),
            "applicationCount": int(row["application_count"]),
            "applicationStatus": row["application_status"],
            "applicationCoverLetter": row["application_cover_letter"],
        }

    def issue_verification(user: Dict[str, Any]) -> bool:
        code = create_email_code()
        code_hash = hash_email_code(code, settings.otp_hash_secret)
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO email_verification_codes (user_id, code_hash, expires_at, sent_at, attempts)
                   VALUES (%s, %s, now() + interval '10 minutes', now(), 0)
                   ON CONFLICT (user_id) DO UPDATE
                   SET code_hash = EXCLUDED.code_hash,
                       expires_at = EXCLUDED.expires_at,
                       sent_at = EXCLUDED.sent_at,
                       attempts = 0
                   WHERE email_verification_codes.sent_at <= now() - interval '60 seconds'
                   RETURNING user_id""",
                (user["id"], code_hash),
            ).fetchone()
        if not inserted:
            return False
        try:
            send_email(user["email"], user["display_name"], code)
        except Exception:
            with database.connection() as connection:
                connection.execute(
                    "DELETE FROM email_verification_codes WHERE user_id = %s AND code_hash = %s",
                    (user["id"], code_hash),
                )
            raise
        return True

    def create_session(user_id: Any, request: Request, response: Response) -> None:
        token = create_session_token()
        token_hash = hash_session_token(token, settings.session_secret)
        expires_at = datetime.now(timezone.utc) + timedelta(days=settings.session_max_age_days)
        with database.connection() as connection:
            old_token = request.cookies.get(cookie_name)
            if old_token:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = %s",
                    (hash_session_token(old_token, settings.session_secret),),
                )
            connection.execute(
                "DELETE FROM auth_sessions WHERE expires_at <= now()",
            )
            connection.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
                (token_hash, user_id, expires_at),
            )
        response.set_cookie(
            cookie_name,
            token,
            max_age=settings.session_max_age_days * 24 * 60 * 60,
            httponly=True,
            secure=settings.production,
            samesite="lax",
            path="/",
        )

    def user_for_session(token: Optional[str]) -> Optional[Dict[str, Any]]:
        if not token:
            return None
        with database.connection() as connection:
            user = connection.execute(
                """SELECT u.id, u.display_name, u.username, u.email, u.bio, u.interests,
                       u.profile_image_url,
                       u.email_verified_at, u.profile_visible, u.discoverable, u.suspended_at
                   FROM auth_sessions s
                   JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = %s AND s.expires_at > now()
                     AND u.email_verified_at IS NOT NULL
                     AND u.suspended_at IS NULL""",
                (hash_session_token(token, settings.session_secret),),
            ).fetchone()
            return user

    def current_user(request: Request) -> Optional[Dict[str, Any]]:
        return user_for_session(request.cookies.get(cookie_name))

    def require_user(request: Request) -> Dict[str, Any]:
        user = current_user(request)
        if not user:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return user

    @app.websocket("/api/realtime")
    async def realtime_socket(websocket: WebSocket) -> None:
        origin = websocket.headers.get("origin")
        allowed_origins = {settings.app_origin}
        if not settings.production:
            allowed_origins.update({
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            })
        if origin and origin not in allowed_origins:
            await websocket.close(code=1008)
            return
        user = await asyncio.to_thread(
            user_for_session,
            websocket.cookies.get(cookie_name),
        )
        if not user:
            await websocket.close(code=1008)
            return

        await websocket.accept()
        connection_id = id(websocket)
        event_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=100)
        register_realtime_connection(
            user["id"],
            connection_id,
            asyncio.get_running_loop(),
            event_queue,
        )
        try:
            await websocket.send_json({"type": "connected"})
            while True:
                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=25)
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping"})
                    continue
                await websocket.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            unregister_realtime_connection(user["id"], connection_id)

    def require_admin(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        if user["email"].strip().lower() in settings.admin_emails:
            return {**user, "role": "super_admin"}
        with database.connection() as connection:
            role = connection.execute(
                "SELECT user_id FROM admin_roles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
        if not role:
            raise ApiError(403, "admin_required", "This account is not authorized to access admin tools.")
        return {**user, "role": "sub_admin"}

    def require_super_admin(request: Request) -> Dict[str, Any]:
        admin = require_admin(request)
        if admin["role"] != "super_admin":
            raise ApiError(403, "super_admin_required", "Only a super administrator can manage administrator roles.")
        return admin

    @app.post("/api/media/images", status_code=201)
    async def upload_image(
        request: Request,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, str]:
        enforce_media_upload_rate_limit(request)
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        formats = {
            "image/jpeg": "JPEG",
            "image/png": "PNG",
            "image/webp": "WEBP",
        }
        expected_format = formats.get(media_type)
        if not expected_format:
            raise ApiError(400, "invalid_image", "Choose a JPEG, PNG, or WebP image.")

        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_IMAGE_BYTES:
                raise ApiError(413, "image_too_large", "Each image must be 4 MB or smaller.")
        try:
            original_bytes = bytes(content)
            source = Image.open(BytesIO(original_bytes))
            if source.format != expected_format:
                raise ApiError(400, "invalid_image", "The uploaded image does not match its content type.")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ApiError(400, "invalid_image", "Images must be 20 megapixels or smaller.")
            source.verify()

            source = Image.open(BytesIO(original_bytes))
            source.load()
            source = ImageOps.exif_transpose(source)
            source.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            has_alpha = "A" in source.getbands() or "transparency" in source.info
            normalized = source.convert("RGBA" if has_alpha else "RGB")
            output = BytesIO()
            normalized.save(output, format="WEBP", quality=82, method=5)
            image_bytes = output.getvalue()
            if len(image_bytes) > MAX_IMAGE_BYTES:
                source = Image.open(BytesIO(original_bytes))
                source.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
                normalized = source.convert("RGBA" if has_alpha else "RGB")
                output = BytesIO()
                normalized.save(output, format="WEBP", quality=70, method=5)
                image_bytes = output.getvalue()
            if len(image_bytes) > MAX_IMAGE_BYTES:
                raise ApiError(413, "image_too_large", "The optimized image is still larger than 4 MB.")
        except ApiError:
            raise
        except (UnidentifiedImageError, OSError, DecompressionBombError) as error:
            raise ApiError(400, "invalid_image", "The uploaded file is not a valid supported image.") from error

        filename = uuid4().hex + ".webp"
        try:
            await asyncio.to_thread(uploads_directory.mkdir, parents=True, exist_ok=True)
            await asyncio.to_thread((uploads_directory / filename).write_bytes, image_bytes)
        except OSError as error:
            logger.exception("Could not save an uploaded image for user %s", user["id"])
            raise ApiError(500, "media_unavailable", "The image could not be saved. Try again later.") from error
        return {"url": "/api/media/images/{}".format(filename)}

    @app.get("/api/media/images/{filename}")
    def get_uploaded_image(filename: str, request: Request) -> Response:
        require_user(request)
        if not re.fullmatch(r"[a-f0-9]{32}\.webp", filename):
            raise ApiError(404, "image_not_found", "That image could not be found.")
        image_path = uploads_directory / filename
        if not image_path.is_file():
            raise ApiError(404, "image_not_found", "That image could not be found.")
        return FileResponse(
            image_path,
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @app.post("/api/media/voice-notes", status_code=201)
    async def upload_voice_note(
        request: Request,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, str]:
        enforce_media_upload_rate_limit(request)
        media_types = {
            "audio/webm": ("webm", "audio/webm"),
            "audio/ogg": ("ogg", "audio/ogg"),
            "audio/mp4": ("mp4", "audio/mp4"),
        }
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        media_file = media_types.get(media_type)
        if not media_file:
            raise ApiError(400, "invalid_voice_note", "Choose a supported WebM, Ogg, or MP4 audio recording.")
        content = bytearray()
        async for chunk in request.stream():
            content.extend(chunk)
            if len(content) > MAX_VOICE_NOTE_BYTES:
                raise ApiError(413, "voice_note_too_large", "Voice notes must be 10 MB or smaller.")
        if len(content) < 128:
            raise ApiError(400, "invalid_voice_note", "This voice recording is empty or incomplete.")
        extension, response_type = media_file
        filename = uuid4().hex + "." + extension
        voice_directory = uploads_directory / "voice-notes"
        try:
            await asyncio.to_thread(voice_directory.mkdir, parents=True, exist_ok=True)
            await asyncio.to_thread((voice_directory / filename).write_bytes, bytes(content))
        except OSError as error:
            logger.exception("Could not save an uploaded voice note for user %s", user["id"])
            raise ApiError(500, "media_unavailable", "The voice note could not be saved. Try again later.") from error
        return {"url": "/api/media/voice-notes/{}".format(filename), "contentType": response_type}

    @app.get("/api/media/voice-notes/{filename}")
    def get_voice_note(filename: str, request: Request) -> Response:
        user = require_user(request)
        if not re.fullmatch(r"[a-f0-9]{32}\.(webm|ogg|mp4)", filename):
            raise ApiError(404, "voice_note_not_found", "That voice note could not be found.")
        audio_url = "/api/media/voice-notes/{}".format(filename)
        with database.connection() as connection:
            authorized = connection.execute(
                """SELECT message.id
                   FROM direct_messages message
                   JOIN direct_conversations conversation ON conversation.id = message.conversation_id
                   WHERE message.audio_url = %s
                     AND (conversation.participant_one_id = %s OR conversation.participant_two_id = %s)
                   LIMIT 1""",
                (audio_url, user["id"], user["id"]),
            ).fetchone()
        if not authorized:
            raise ApiError(404, "voice_note_not_found", "That voice note could not be found.")
        media_type = {"webm": "audio/webm", "ogg": "audio/ogg", "mp4": "audio/mp4"}[filename.rsplit(".", 1)[1]]
        audio_path = uploads_directory / "voice-notes" / filename
        if not audio_path.is_file():
            raise ApiError(404, "voice_note_not_found", "That voice note could not be found.")
        return FileResponse(
            audio_path,
            media_type=media_type,
            headers={"Cache-Control": "private, no-store"},
        )

    @app.post("/api/assistant/chat")
    def chat_with_assistant(
        input: AssistantChatInput,
        request: Request,
    ) -> Dict[str, str]:
        user = require_user(request)
        if not settings.gemini_api_key:
            raise ApiError(
                503,
                "assistant_not_configured",
                "The AI assistant is not configured on this server yet.",
            )
        enforce_ai_rate_limit(user["id"])
        provider_payload = {
            "systemInstruction": {
                "parts": [{
                    "text": (
                        "You are iConnect Assistant, a friendly and helpful general-purpose assistant. "
                        "Be clear, practical, and respectful. You do not have access to iConnect accounts, "
                        "private messages, profiles, or live data, and cannot perform actions in the app. "
                        "Do not present guesses as facts. For medical, legal, or financial topics, provide "
                        "general information and encourage consulting a qualified professional."
                    ),
                }],
            },
            "contents": [
                {
                    "role": message.role,
                    "parts": [{"text": message.text}],
                }
                for message in input.messages
            ],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 900,
            },
        }
        provider_request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent".format(
                settings.gemini_model,
            ),
            data=json.dumps(provider_payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": settings.gemini_api_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(provider_request, timeout=30) as response:
                provider_result = json.loads(response.read(512 * 1024))
        except urllib.error.HTTPError as error:
            logger.warning("Gemini assistant request failed with HTTP %s", error.code)
            raise ApiError(
                502,
                "assistant_provider_error",
                "The AI assistant couldn’t respond right now. Please try again.",
            ) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            logger.warning("Gemini assistant request could not reach the provider: %s", type(error).__name__)
            raise ApiError(
                502,
                "assistant_provider_unavailable",
                "The AI service could not be reached. Please try again.",
            ) from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            logger.warning("Gemini assistant returned an invalid response.")
            raise ApiError(
                502,
                "assistant_invalid_response",
                "The AI service returned an invalid response. Please try again.",
            ) from error

        if not isinstance(provider_result, dict):
            raise ApiError(
                502,
                "assistant_invalid_response",
                "The AI service returned an invalid response. Please try again.",
            )
        candidates = provider_result.get("candidates")
        candidate = candidates[0] if isinstance(candidates, list) and candidates else None
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        reply = "\n".join(
            part["text"]
            for part in (parts if isinstance(parts, list) else [])
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ).strip()
        if not reply:
            raise ApiError(
                502,
                "assistant_empty_response",
                "The AI service couldn’t create a response. Please try rephrasing your request.",
            )
        return {"reply": reply}

    def public_billing_plan(row: Dict[str, Any]) -> Dict[str, Any]:
        limits = row.get("posting_limits") or {}
        if isinstance(limits, str):
            limits = json.loads(limits)
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "currency": row["currency"],
            "amountMinor": int(row["amount_minor"]),
            "postingLimits": {
                category: int(limits.get(category, 0))
                for category in ("jobs", "products", "marketplace", "videos")
            },
            "active": bool(row["active"]),
            "countryCodes": list(row.get("country_codes") or []),
        }

    def billing_location(request: Request) -> Tuple[Optional[str], str]:
        return resolve_country(
            request.headers,
            request.client.host if request.client else None,
            settings.trust_proxy,
            settings.geoip_country_db,
        )

    def plans_for_country(rows: List[Dict[str, Any]], country: Optional[str]) -> List[Dict[str, Any]]:
        has_country_plans = bool(country) and any(country in (row.get("country_codes") or []) for row in rows)
        return [
            row for row in rows
            if plan_visible_in_country(row.get("country_codes"), country, has_country_plans)
        ]

    def dating_currency_for_country(country: Optional[str]) -> Optional[str]:
        if country is None:
            return None
        return "NGN" if country == "NG" else "USD"

    def verify_billing_provider(provider: str, secret: str, path: str) -> Dict[str, Any]:
        try:
            return provider_request(provider, secret, path)
        except BillingProviderError as error:
            logger.warning(
                "%s billing verification failed (HTTP %s): %s",
                provider, error.status_code, error.detail,
            )
            raise ApiError(
                502,
                "payment_verification_failed",
                "The payment provider could not verify this payment. Try again shortly.",
            ) from error

    def activate_billing_transaction(
        connection: Any,
        transaction: Dict[str, Any],
        provider_data: Optional[Dict[str, Any]] = None,
        provider_subscription_id: Optional[str] = None,
        provider_customer_id: Optional[str] = None,
        provider_email_token: Optional[str] = None,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
    ) -> bool:
        updated = connection.execute(
            """UPDATE billing_transactions
               SET status = 'paid', paid_at = COALESCE(paid_at, now())
               WHERE id = %s AND status <> 'paid'
               RETURNING id, user_id, subscription_id, dating_product_id, order_id, transaction_type""",
            (transaction["id"],),
        ).fetchone()
        if not updated:
            return False
        if updated["transaction_type"] == "subscription":
            period_start = period_start or datetime.now(timezone.utc)
            period_end = period_end or period_start + timedelta(days=30)
            connection.execute(
                """UPDATE billing_subscriptions
                   SET status = 'active',
                       provider_subscription_id = COALESCE(%s, provider_subscription_id),
                       provider_customer_id = COALESCE(%s, provider_customer_id),
                       provider_email_token = COALESCE(%s, provider_email_token),
                       current_period_start = %s,
                       current_period_end = %s,
                       updated_at = now()
                   WHERE id = %s""",
                (
                    provider_subscription_id,
                    provider_customer_id,
                    provider_email_token,
                    period_start,
                    period_end,
                    updated["subscription_id"],
                ),
            )
        elif updated["dating_product_id"]:
            product = connection.execute(
                """SELECT quantity, duration_hours, code
                   FROM dating_billing_products WHERE id = %s""",
                (updated["dating_product_id"],),
            ).fetchone()
            if not product:
                raise ApiError(500, "billing_configuration_error", "The purchased dating add-on is unavailable.")
            expires_at = (
                datetime.now(timezone.utc) + timedelta(hours=int(product["duration_hours"]))
                if int(product["duration_hours"]) > 0
                else None
            )
            connection.execute(
                """INSERT INTO dating_entitlements
                       (user_id, product_id, transaction_id, quantity_remaining,
                        starts_at, expires_at)
                   VALUES (%s, %s, %s, %s, now(), %s)""",
                (
                    updated["user_id"],
                    updated["dating_product_id"],
                    updated["id"],
                    int(product["quantity"]) if product["code"] == "extra_likes" else 0,
                    expires_at,
                ),
            )
        elif updated["order_id"]:
            order = connection.execute(
                """UPDATE marketplace_orders
                   SET status = 'paid', paid_at = COALESCE(paid_at, now())
                   WHERE id = %s AND status = 'pending'""",
                (updated["order_id"],),
            ).fetchone()
            if not order:
                reserved = connection.execute(
                    """UPDATE marketplace_products product
                       SET stock = product.stock - order_row.quantity
                       FROM marketplace_orders order_row
                       WHERE order_row.id = %s
                         AND order_row.status IN ('expired', 'payment_failed')
                         AND product.id = order_row.product_id
                         AND product.stock >= order_row.quantity
                       RETURNING order_row.id""",
                    (updated["order_id"],),
                ).fetchone()
                if reserved:
                    connection.execute(
                        """UPDATE marketplace_orders
                           SET status = 'paid', paid_at = COALESCE(paid_at, now())
                           WHERE id = %s AND status IN ('expired', 'payment_failed')""",
                        (updated["order_id"],),
                    )
                else:
                    connection.execute(
                        """UPDATE marketplace_orders
                           SET status = 'refund_required'
                           WHERE id = %s AND status IN ('expired', 'payment_failed')""",
                        (updated["order_id"],),
                    )
        return True

    def release_expired_marketplace_orders(connection: Any) -> None:
        connection.execute(
            """WITH expired AS (
                   UPDATE marketplace_orders
                   SET status = 'expired'
                   WHERE status = 'pending' AND expires_at <= now()
                   RETURNING product_id, quantity
               ),
               released AS (
                   SELECT product_id, sum(quantity)::integer AS quantity
                   FROM expired GROUP BY product_id
               )
               UPDATE marketplace_products product
               SET stock = product.stock + released.quantity
               FROM released
               WHERE product.id = released.product_id"""
        )

    def fail_marketplace_transaction(
        connection: Any,
        transaction_id: Any,
        status: str = "payment_failed",
    ) -> None:
        transaction = connection.execute(
            """UPDATE billing_transactions
               SET status = 'failed'
               WHERE id = %s AND status = 'pending'
               RETURNING order_id""",
            (transaction_id,),
        ).fetchone()
        if not transaction or not transaction.get("order_id"):
            return
        order = connection.execute(
            """UPDATE marketplace_orders
               SET status = %s
               WHERE id = %s AND status = 'pending'
               RETURNING product_id, quantity""",
            (status, transaction["order_id"]),
        ).fetchone()
        if order:
            connection.execute(
                "UPDATE marketplace_products SET stock = stock + %s WHERE id = %s",
                (order["quantity"], order["product_id"]),
            )

    @app.get("/api/billing/location")
    def get_billing_location(request: Request) -> Dict[str, Any]:
        require_user(request)
        country, source = billing_location(request)
        return {"country": country, "source": source}

    @app.get("/api/billing/catalog")
    def get_billing_catalog(request: Request) -> Dict[str, Any]:
        require_user(request)
        country, source = billing_location(request)
        with database.connection() as connection:
            plans = connection.execute(
                """SELECT id, name, currency, amount_minor, posting_limits, active, country_codes
                   FROM subscription_plans WHERE active
                   ORDER BY currency, amount_minor, name"""
            ).fetchall()
            products = connection.execute(
                """SELECT id, code, name, currency, amount_minor, quantity,
                          duration_hours
                   FROM dating_billing_products
                   WHERE active AND amount_minor > 0
                   ORDER BY currency, code, amount_minor"""
            ).fetchall()
        dating_currency = dating_currency_for_country(country)
        if dating_currency:
            products = [product for product in products if product["currency"] == dating_currency]
        return {
            "location": {"country": country, "source": source},
            "plans": [public_billing_plan(plan) for plan in plans_for_country(plans, country)],
            "datingProducts": [{
                "id": str(product["id"]),
                "code": product["code"],
                "name": product["name"],
                "currency": product["currency"],
                "amountMinor": int(product["amount_minor"]),
                "quantity": int(product["quantity"]),
                "durationHours": int(product["duration_hours"]),
            } for product in products],
        }

    @app.get("/api/billing/me")
    def get_member_billing(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        categories = ("jobs", "products", "marketplace", "videos")
        with database.connection() as connection:
            subscription = connection.execute(
                """SELECT subscription.id, subscription.status, subscription.currency,
                          subscription.amount_minor, subscription.current_period_start,
                          subscription.current_period_end, subscription.cancel_at_period_end,
                          plan.id AS plan_id, plan.name, plan.posting_limits
                   FROM billing_subscriptions subscription
                   JOIN subscription_plans plan ON plan.id = subscription.plan_id
                   WHERE subscription.user_id = %s
                     AND subscription.status IN ('active', 'past_due')
                     AND (subscription.current_period_end IS NULL
                          OR subscription.current_period_end > now())
                   ORDER BY subscription.created_at DESC
                   LIMIT 1""",
                (user["id"],),
            ).fetchone()
            quota_state = {
                category: posting_quota_snapshot(connection, user["id"], category)
                for category in categories
            }
            settings_row = connection.execute(
                """SELECT free_daily_dating_likes
                   FROM posting_quota_settings WHERE id = 1"""
            ).fetchone()
            likes = connection.execute(
                """SELECT count(*) AS used
                   FROM dating_swipes
                   WHERE user_id = %s AND liked
                     AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')""",
                (user["id"],),
            ).fetchone()
            credits = connection.execute(
                """SELECT COALESCE(sum(quantity_remaining), 0) AS remaining
                   FROM dating_entitlements
                   JOIN dating_billing_products product ON product.id = dating_entitlements.product_id
                   WHERE user_id = %s AND product.code = 'extra_likes'
                     AND quantity_remaining > 0
                     AND (expires_at IS NULL OR expires_at > now())""",
                (user["id"],),
            ).fetchone()
            boosts = connection.execute(
                """SELECT EXISTS (
                       SELECT 1 FROM dating_entitlements
                       JOIN dating_billing_products product ON product.id = dating_entitlements.product_id
                       WHERE user_id = %s AND product.code = 'profile_boost'
                         AND expires_at > now()
                   ) AS active""",
                (user["id"],),
            ).fetchone()
        limits = subscription.get("posting_limits") if subscription else None
        if isinstance(limits, str):
            limits = json.loads(limits)
        return {
            "subscription": ({
                "id": str(subscription["id"]),
                "planId": str(subscription["plan_id"]),
                "name": subscription["name"],
                "status": subscription["status"],
                "currency": subscription["currency"],
                "amountMinor": int(subscription["amount_minor"]),
                "currentPeriodStart": (
                    subscription["current_period_start"].isoformat()
                    if subscription["current_period_start"] else None
                ),
                "currentPeriodEnd": (
                    subscription["current_period_end"].isoformat()
                    if subscription["current_period_end"] else None
                ),
                "cancelAtPeriodEnd": bool(subscription["cancel_at_period_end"]),
            } if subscription else None),
            "postingQuotas": quota_state,
            "dating": {
                "freeLikesPerDay": int(settings_row["free_daily_dating_likes"]) if settings_row else 0,
                "likesUsedToday": int(likes["used"]) if likes else 0,
                "extraLikesRemaining": int(credits["remaining"]) if credits else 0,
                "profileBoostActive": bool(boosts["active"]) if boosts else False,
            },
            "planLimits": limits,
        }

    @app.post("/api/billing/checkout", status_code=201)
    def create_billing_checkout(
        input: BillingCheckoutInput,
        request: Request,
    ) -> Dict[str, str]:
        user = require_user(request)
        country, _source = billing_location(request)
        plan = None
        product = None
        if input.plan_id:
            with database.connection() as connection:
                plan = connection.execute(
                    """SELECT id, name, currency, amount_minor, posting_limits,
                              paystack_plan_code, country_codes
                       FROM subscription_plans WHERE id = %s AND active""",
                    (input.plan_id,),
                ).fetchone()
                if plan and country:
                    has_country_plans = connection.execute(
                        """SELECT EXISTS (
                               SELECT 1 FROM subscription_plans
                               WHERE active AND %s = ANY(country_codes)
                           ) AS present""",
                        (country,),
                    ).fetchone()["present"]
                    if not plan_visible_in_country(plan["country_codes"], country, has_country_plans):
                        raise ApiError(
                            403,
                            "plan_not_available_in_region",
                            "This plan is not available in your country. Refresh to see your local prices.",
                        )
                active = connection.execute(
                    """SELECT id FROM billing_subscriptions
                       WHERE user_id = %s AND status IN ('active', 'past_due')
                         AND (current_period_end IS NULL OR current_period_end > now())
                       LIMIT 1""",
                    (user["id"],),
                ).fetchone()
            if not plan:
                raise ApiError(404, "billing_plan_not_found", "That publisher plan is not available.")
            if active:
                raise ApiError(409, "subscription_already_active", "You already have an active publisher plan.")
            transaction_type = "subscription"
        else:
            with database.connection() as connection:
                product = connection.execute(
                    """SELECT id, code, name, currency, amount_minor, quantity,
                              duration_hours
                       FROM dating_billing_products
                       WHERE id = %s AND active AND amount_minor > 0""",
                    (input.dating_product_id,),
                ).fetchone()
            if not product:
                raise ApiError(404, "dating_product_not_found", "That dating add-on is not available.")
            local_currency = dating_currency_for_country(country)
            if local_currency and product["currency"] != local_currency:
                raise ApiError(
                    403,
                    "product_not_available_in_region",
                    "This add-on is not available in your country. Refresh to see your local prices.",
                )
            transaction_type = "dating_boost" if product["code"] == "profile_boost" else "dating_likes"

        provider = "paystack" if (plan or product)["currency"] == "NGN" else "stripe"
        secret_key = settings.paystack_secret_key if provider == "paystack" else settings.stripe_secret_key
        if not secret_key:
            raise ApiError(
                503,
                "payment_provider_not_configured",
                "{} checkout is not configured on this server yet.".format(
                    "Paystack" if provider == "paystack" else "Stripe",
                ),
            )
        reference = "ic_" + uuid4().hex
        item = plan or product
        with database.connection() as connection:
            subscription_id = None
            if plan:
                subscription = connection.execute(
                    """INSERT INTO billing_subscriptions
                           (user_id, plan_id, provider, currency, amount_minor)
                       VALUES (%s, %s, %s, %s, %s)
                       RETURNING id""",
                    (user["id"], plan["id"], provider, plan["currency"], plan["amount_minor"]),
                ).fetchone()
                subscription_id = subscription["id"]
            inserted = connection.execute(
                """INSERT INTO billing_transactions
                       (user_id, subscription_id, plan_id, dating_product_id,
                        provider, provider_reference, transaction_type, currency, amount_minor)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    subscription_id,
                    plan["id"] if plan else None,
                    product["id"] if product else None,
                    provider,
                    reference,
                    transaction_type,
                    item["currency"],
                    item["amount_minor"],
                ),
            ).fetchone()

        app_billing_url = settings.app_origin + "/app/billing"
        try:
            if provider == "paystack":
                plan_code = plan.get("paystack_plan_code") if plan else None
                if plan and not plan_code:
                    provider_plan = provider_request(
                        provider,
                        secret_key,
                        "/plan",
                        {
                            "name": "iConnect {} {}".format(plan["name"], str(plan["id"])[:8]),
                            "interval": "monthly",
                            "amount": int(plan["amount_minor"]),
                            "currency": "NGN",
                        },
                    )
                    plan_data = provider_plan.get("data") or {}
                    plan_code = plan_data.get("plan_code") if isinstance(plan_data, dict) else None
                    if not plan_code:
                        raise BillingProviderError()
                    with database.connection() as connection:
                        connection.execute(
                            "UPDATE subscription_plans SET paystack_plan_code = %s WHERE id = %s",
                            (plan_code, plan["id"]),
                        )
                        connection.execute(
                            "UPDATE billing_transactions SET provider_plan_code = %s WHERE id = %s",
                            (plan_code, inserted["id"]),
                        )
                checkout_payload = {
                    "email": user["email"],
                    "amount": int(item["amount_minor"]),
                    "currency": item["currency"],
                    "reference": reference,
                    "callback_url": app_billing_url + "?reference=" + reference,
                    "metadata": {
                        "transaction_id": str(inserted["id"]),
                        "user_id": str(user["id"]),
                    },
                }
                if plan_code:
                    checkout_payload["plan"] = plan_code
                result = provider_request(
                    provider,
                    secret_key,
                    "/transaction/initialize",
                    checkout_payload,
                )
                data = result.get("data") or {}
                checkout_url = data.get("authorization_url") if isinstance(data, dict) else None
            else:
                mode = "subscription" if plan else "payment"
                payload = {
                    "mode": mode,
                    "success_url": app_billing_url + "?status=success&reference={CHECKOUT_SESSION_ID}",
                    "cancel_url": app_billing_url + "?status=cancelled",
                    "customer_email": user["email"],
                    "client_reference_id": reference,
                    "metadata[transaction_id]": str(inserted["id"]),
                    "line_items[0][price_data][currency]": str(item["currency"]).lower(),
                    "line_items[0][price_data][unit_amount]": str(int(item["amount_minor"])),
                    "line_items[0][price_data][product_data][name]": item["name"],
                    "line_items[0][quantity]": "1",
                }
                if plan:
                    payload["line_items[0][price_data][recurring][interval]"] = "month"
                    payload["subscription_data[metadata][transaction_id]"] = str(inserted["id"])
                else:
                    payload["payment_intent_data[metadata][transaction_id]"] = str(inserted["id"])
                result = provider_request(
                    provider,
                    secret_key,
                    "/v1/checkout/sessions",
                    payload,
                )
                checkout_url = result.get("url")
                reference = result.get("id") or reference
                if result.get("id"):
                    with database.connection() as connection:
                        connection.execute(
                            """UPDATE billing_transactions SET provider_reference = %s
                               WHERE id = %s""",
                            (reference, inserted["id"]),
                        )
        except BillingProviderError as error:
            logger.warning(
                "%s checkout initialization failed (HTTP %s): %s",
                provider, error.status_code, error.detail,
            )
            with database.connection() as connection:
                connection.execute(
                    "UPDATE billing_transactions SET status = 'failed' WHERE id = %s",
                    (inserted["id"],),
                )
                if subscription_id:
                    connection.execute(
                        "UPDATE billing_subscriptions SET status = 'cancelled', updated_at = now() WHERE id = %s",
                        (subscription_id,),
                    )
            raise ApiError(
                502,
                "checkout_initialization_failed",
                "The payment provider could not start checkout. Please try again.",
            ) from error
        if not isinstance(checkout_url, str) or not checkout_url.startswith("https://"):
            raise ApiError(
                502,
                "checkout_initialization_failed",
                "The payment provider returned an invalid checkout link.",
            )
        return {"checkoutUrl": checkout_url, "reference": reference, "provider": provider}

    @app.post("/api/billing/confirm")
    def confirm_billing_payment(
        input: BillingConfirmInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            transaction = connection.execute(
                """SELECT id, user_id, subscription_id, dating_product_id,
                          provider, provider_reference, transaction_type, currency,
                          amount_minor, status
                   FROM billing_transactions
                   WHERE user_id = %s AND provider_reference = %s""",
                (user["id"], input.reference),
            ).fetchone()
        if not transaction:
            raise ApiError(404, "payment_not_found", "That payment could not be found.")
        if transaction["status"] == "paid":
            return {"status": "paid"}
        provider = transaction["provider"]
        secret_key = settings.paystack_secret_key if provider == "paystack" else settings.stripe_secret_key
        path = (
            "/transaction/verify/" + urllib.parse.quote(input.reference, safe="")
            if provider == "paystack"
            else "/v1/checkout/sessions/" + urllib.parse.quote(input.reference, safe="")
        )
        verification = verify_billing_provider(provider, secret_key, path)
        data = verification.get("data") if provider == "paystack" else verification
        if not isinstance(data, dict):
            raise ApiError(502, "payment_verification_failed", "The payment provider returned an invalid payment.")
        if provider == "paystack":
            paid = data.get("status") == "success"
            verified_amount = data.get("amount")
            verified_currency = data.get("currency")
            provider_subscription_id = (
                (data.get("subscription") or {}).get("subscription_code")
                if isinstance(data.get("subscription"), dict)
                else None
            )
            provider_customer_id = (
                (data.get("customer") or {}).get("customer_code")
                if isinstance(data.get("customer"), dict)
                else None
            )
        else:
            paid = data.get("payment_status") == "paid"
            verified_amount = data.get("amount_total")
            verified_currency = str(data.get("currency") or "").upper()
            provider_subscription_id = data.get("subscription")
            provider_customer_id = data.get("customer")
        if (
            not paid
            or int(verified_amount or -1) != int(transaction["amount_minor"])
            or str(verified_currency or "").upper() != transaction["currency"]
        ):
            raise ApiError(409, "payment_not_completed", "Payment is not confirmed yet. If you paid, wait and refresh.")
        period_start = period_end = None
        if provider == "stripe" and provider_subscription_id:
            subscription_data = verify_billing_provider(
                provider,
                secret_key,
                "/v1/subscriptions/" + urllib.parse.quote(str(provider_subscription_id), safe=""),
            )
            period_start = parse_provider_datetime(subscription_data.get("current_period_start"))
            period_end = parse_provider_datetime(subscription_data.get("current_period_end"))
        with database.connection() as connection:
            activate_billing_transaction(
                connection,
                transaction,
                data,
                str(provider_subscription_id) if provider_subscription_id else None,
                str(provider_customer_id) if provider_customer_id else None,
                period_start=period_start,
                period_end=period_end,
            )
        return {"status": "paid"}

    @app.post("/api/billing/subscription/cancel")
    def cancel_billing_subscription(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            subscription = connection.execute(
                """SELECT id, provider, provider_subscription_id,
                          provider_email_token, current_period_end
                   FROM billing_subscriptions
                   WHERE user_id = %s AND status IN ('active', 'past_due')
                     AND (current_period_end IS NULL OR current_period_end > now())
                   ORDER BY created_at DESC LIMIT 1""",
                (user["id"],),
            ).fetchone()
        if not subscription:
            raise ApiError(404, "subscription_not_found", "You do not have an active publisher plan.")
        provider = subscription["provider"]
        secret_key = settings.paystack_secret_key if provider == "paystack" else settings.stripe_secret_key
        provider_id = subscription["provider_subscription_id"]
        if not provider_id:
            raise ApiError(
                409,
                "subscription_not_ready",
                "The provider is still confirming your subscription. Try again shortly.",
            )
        if provider == "stripe":
            try:
                result = provider_request(
                    provider,
                    secret_key,
                    "/v1/subscriptions/" + urllib.parse.quote(str(provider_id), safe=""),
                    {"cancel_at_period_end": "true"},
                )
            except BillingProviderError as error:
                logger.warning("Stripe subscription cancellation failed (HTTP %s)", error.status_code)
                raise ApiError(
                    502,
                    "subscription_cancel_failed",
                    "Stripe could not schedule subscription cancellation.",
                ) from error
            if not isinstance(result, dict) or result.get("cancel_at_period_end") is not True:
                raise ApiError(502, "subscription_cancel_failed", "The payment provider could not schedule cancellation.")
            with database.connection() as connection:
                connection.execute(
                    """UPDATE billing_subscriptions
                       SET cancel_at_period_end = true, updated_at = now()
                       WHERE id = %s""",
                    (subscription["id"],),
                )
            return {
                "cancelAtPeriodEnd": True,
                "currentPeriodEnd": (
                    subscription["current_period_end"].isoformat()
                    if subscription["current_period_end"] else None
                ),
            }
        if not subscription["provider_email_token"]:
            raise ApiError(
                409,
                "subscription_cancel_unavailable",
                "Paystack has not sent the cancellation token yet. Contact support if this continues.",
            )
        try:
            provider_request(
                provider,
                secret_key,
                "/subscription/disable",
                {
                    "code": str(provider_id),
                    "token": subscription["provider_email_token"],
                },
            )
        except BillingProviderError as error:
            logger.warning("Paystack subscription cancellation failed (HTTP %s)", error.status_code)
            raise ApiError(502, "subscription_cancel_failed", "Paystack could not cancel this subscription.") from error
        with database.connection() as connection:
            connection.execute(
                """UPDATE billing_subscriptions
                   SET cancel_at_period_end = true, updated_at = now()
                   WHERE id = %s""",
                (subscription["id"],),
            )
        return {
            "cancelAtPeriodEnd": True,
            "currentPeriodEnd": (
                subscription["current_period_end"].isoformat()
                if subscription["current_period_end"] else None
            ),
        }

    def process_stripe_event(event: Dict[str, Any]) -> None:
        event_type = event.get("type")
        event_object = (event.get("data") or {}).get("object")
        if not isinstance(event_object, dict):
            raise ApiError(400, "invalid_webhook", "The payment event is invalid.")
        with database.connection() as connection:
            event_row = connection.execute(
                """INSERT INTO billing_webhook_events (provider, event_id)
                   VALUES ('stripe', %s)
                   ON CONFLICT DO NOTHING
                   RETURNING event_id""",
                (str(event.get("id") or ""),),
            ).fetchone()
            if not event_row:
                return

            if event_type in {
                "checkout.session.completed",
                "checkout.session.async_payment_succeeded",
            }:
                metadata = event_object.get("metadata") or {}
                transaction_id = metadata.get("transaction_id") if isinstance(metadata, dict) else None
                transaction = connection.execute(
                    """SELECT id, user_id, subscription_id, dating_product_id,
                              provider, provider_reference, transaction_type, currency,
                              amount_minor, status
                       FROM billing_transactions WHERE id = %s AND provider = 'stripe'""",
                    (transaction_id,),
                ).fetchone() if transaction_id else None
                if (
                    transaction
                    and event_object.get("payment_status") == "paid"
                    and int(event_object.get("amount_total") or -1) == int(transaction["amount_minor"])
                    and str(event_object.get("currency") or "").upper() == transaction["currency"]
                ):
                    activate_billing_transaction(
                        connection,
                        transaction,
                        event_object,
                        str(event_object["subscription"]) if event_object.get("subscription") else None,
                        str(event_object["customer"]) if event_object.get("customer") else None,
                    )
            elif event_type in {
                "checkout.session.expired",
                "checkout.session.async_payment_failed",
                "payment_intent.payment_failed",
            }:
                metadata = event_object.get("metadata") or {}
                transaction_id = metadata.get("transaction_id") if isinstance(metadata, dict) else None
                transaction = connection.execute(
                    """SELECT id, transaction_type FROM billing_transactions
                       WHERE id = %s AND provider = 'stripe'""",
                    (transaction_id,),
                ).fetchone() if transaction_id else None
                if transaction and transaction["transaction_type"] == "marketplace_order":
                    fail_marketplace_transaction(connection, transaction["id"])
            elif event_type in {"invoice.paid", "invoice.payment_succeeded"}:
                subscription_id = event_object.get("subscription")
                if not subscription_id and isinstance(event_object.get("parent"), dict):
                    details = event_object["parent"].get("subscription_details")
                    if isinstance(details, dict):
                        subscription_id = details.get("subscription")
                subscription = connection.execute(
                    """SELECT id, user_id, plan_id, currency
                       FROM billing_subscriptions
                       WHERE provider = 'stripe' AND provider_subscription_id = %s""",
                    (str(subscription_id),),
                ).fetchone() if subscription_id else None
                if subscription:
                    amount = int(event_object.get("amount_paid") or 0)
                    invoice_id = str(event_object.get("id") or "")
                    currency = str(event_object.get("currency") or subscription["currency"]).upper()
                    if amount > 0 and invoice_id and currency == subscription["currency"]:
                        connection.execute(
                            """INSERT INTO billing_transactions
                                   (user_id, subscription_id, plan_id, provider,
                                    provider_reference, transaction_type, currency,
                                    amount_minor, status, paid_at)
                               VALUES (%s, %s, %s, 'stripe', %s, 'subscription',
                                       %s, %s, 'paid', now())
                               ON CONFLICT (provider, provider_reference) DO NOTHING""",
                            (
                                subscription["user_id"], subscription["id"], subscription["plan_id"],
                                invoice_id, currency, amount,
                            ),
                        )
                    lines = event_object.get("lines") or {}
                    data_lines = lines.get("data") if isinstance(lines, dict) else []
                    line_period = data_lines[0].get("period") if data_lines and isinstance(data_lines[0], dict) else {}
                    period_start = parse_provider_datetime(line_period.get("start")) if isinstance(line_period, dict) else None
                    period_end = parse_provider_datetime(line_period.get("end")) if isinstance(line_period, dict) else None
                    connection.execute(
                        """UPDATE billing_subscriptions
                           SET status = 'active',
                               current_period_start = COALESCE(%s, current_period_start),
                               current_period_end = COALESCE(%s, current_period_end),
                               updated_at = now()
                           WHERE id = %s""",
                        (period_start, period_end, subscription["id"]),
                    )
            elif event_type == "invoice.payment_failed":
                subscription_id = event_object.get("subscription")
                if not subscription_id and isinstance(event_object.get("parent"), dict):
                    details = event_object["parent"].get("subscription_details")
                    if isinstance(details, dict):
                        subscription_id = details.get("subscription")
                if subscription_id:
                    connection.execute(
                        """UPDATE billing_subscriptions SET status = 'past_due', updated_at = now()
                           WHERE provider = 'stripe' AND provider_subscription_id = %s
                             AND status <> 'cancelled'""",
                        (str(subscription_id),),
                    )
            elif event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
                provider_subscription_id = event_object.get("id")
                status = (
                    "cancelled" if event_type == "customer.subscription.deleted"
                    or event_object.get("status") in {"canceled", "incomplete_expired"}
                    else "past_due" if event_object.get("status") == "past_due"
                    else "active" if event_object.get("status") in {"active", "trialing"}
                    else "pending"
                )
                connection.execute(
                    """UPDATE billing_subscriptions
                       SET status = %s,
                           cancel_at_period_end = %s,
                           current_period_start = COALESCE(%s, current_period_start),
                           current_period_end = COALESCE(%s, current_period_end),
                           updated_at = now()
                       WHERE provider = 'stripe' AND provider_subscription_id = %s""",
                    (
                        status,
                        bool(event_object.get("cancel_at_period_end")),
                        parse_provider_datetime(event_object.get("current_period_start")),
                        parse_provider_datetime(event_object.get("current_period_end")),
                        str(provider_subscription_id),
                    ),
                )

    def process_paystack_event(event: Dict[str, Any]) -> None:
        event_type = event.get("event")
        data = event.get("data")
        if not isinstance(data, dict):
            raise ApiError(400, "invalid_webhook", "The payment event is invalid.")
        with database.connection() as connection:
            event_row = connection.execute(
                """INSERT INTO billing_webhook_events (provider, event_id)
                   VALUES ('paystack', %s)
                   ON CONFLICT DO NOTHING
                   RETURNING event_id""",
                (str(data.get("id") or data.get("reference") or uuid4()),),
            ).fetchone()
            if not event_row:
                return

            if event_type in {"charge.success", "charge.failed"}:
                reference = str(data.get("reference") or "")
                transaction = connection.execute(
                    """SELECT id, user_id, subscription_id, dating_product_id,
                              provider, provider_reference, transaction_type, currency,
                              amount_minor, status
                       FROM billing_transactions
                       WHERE provider = 'paystack' AND provider_reference = %s""",
                    (reference,),
                ).fetchone()
                if event_type == "charge.failed":
                    if transaction and transaction["transaction_type"] == "marketplace_order":
                        fail_marketplace_transaction(connection, transaction["id"])
                    return
                subscription_data = data.get("subscription")
                subscription_data = subscription_data if isinstance(subscription_data, dict) else {}
                plan_data = data.get("plan")
                plan_data = plan_data if isinstance(plan_data, dict) else {}
                subscription_code = (
                    subscription_data.get("subscription_code")
                    or data.get("subscription_code")
                )
                customer_data = data.get("customer")
                customer_data = customer_data if isinstance(customer_data, dict) else {}
                if transaction:
                    if (
                        data.get("status") == "success"
                        and int(data.get("amount") or -1) == int(transaction["amount_minor"])
                        and str(data.get("currency") or "").upper() == transaction["currency"]
                    ):
                        activate_billing_transaction(
                            connection,
                            transaction,
                            data,
                            str(subscription_code) if subscription_code else None,
                            str(customer_data.get("customer_code")) if customer_data.get("customer_code") else None,
                        )
                elif subscription_code:
                    subscription = connection.execute(
                        """SELECT id, user_id, plan_id, currency
                           FROM billing_subscriptions
                           WHERE provider = 'paystack' AND provider_subscription_id = %s""",
                        (str(subscription_code),),
                    ).fetchone()
                    if subscription and int(data.get("amount") or 0) > 0:
                        transaction_reference = reference or "paystack_" + str(data.get("id") or uuid4())
                        connection.execute(
                            """INSERT INTO billing_transactions
                                   (user_id, subscription_id, plan_id, provider,
                                    provider_reference, transaction_type, currency,
                                    amount_minor, status, paid_at)
                               VALUES (%s, %s, %s, 'paystack', %s, 'subscription',
                                       %s, %s, 'paid', now())
                               ON CONFLICT (provider, provider_reference) DO NOTHING""",
                            (
                                subscription["user_id"], subscription["id"], subscription["plan_id"],
                                transaction_reference, subscription["currency"], int(data["amount"]),
                            ),
                        )
                        connection.execute(
                            """UPDATE billing_subscriptions
                               SET status = 'active',
                                   current_period_start = now(),
                                   current_period_end = COALESCE(%s, now() + interval '30 days'),
                                   updated_at = now()
                               WHERE id = %s""",
                            (
                                parse_provider_datetime(subscription_data.get("next_payment_date")),
                                subscription["id"],
                            ),
                        )
            elif event_type == "subscription.create":
                subscription_code = data.get("subscription_code")
                plan_data = data.get("plan") if isinstance(data.get("plan"), dict) else {}
                plan_code = plan_data.get("plan_code")
                customer_data = data.get("customer") if isinstance(data.get("customer"), dict) else {}
                customer_email = customer_data.get("email")
                if subscription_code and plan_code and customer_email:
                    pending = connection.execute(
                        """SELECT subscription.id, subscription.user_id
                           FROM billing_subscriptions subscription
                           JOIN billing_transactions transaction
                             ON transaction.subscription_id = subscription.id
                           JOIN users ON users.id = subscription.user_id
                           WHERE subscription.provider = 'paystack'
                             AND transaction.provider_plan_code = %s
                             AND lower(users.email) = lower(%s)
                           ORDER BY transaction.created_at DESC LIMIT 1""",
                        (str(plan_code), str(customer_email)),
                    ).fetchone()
                    if pending:
                        connection.execute(
                            """UPDATE billing_subscriptions
                               SET provider_subscription_id = %s,
                                   provider_customer_id = %s,
                                   provider_email_token = %s,
                                   current_period_start = COALESCE(%s, now()),
                                   current_period_end = COALESCE(%s, now() + interval '30 days'),
                                   updated_at = now()
                               WHERE id = %s""",
                            (
                                str(subscription_code),
                                str(customer_data.get("customer_code")) if customer_data.get("customer_code") else None,
                                str(data.get("email_token")) if data.get("email_token") else None,
                                parse_provider_datetime(data.get("createdAt")),
                                parse_provider_datetime(data.get("next_payment_date")),
                                pending["id"],
                            ),
                        )
            elif event_type in {"invoice.payment_failed", "invoice.update"}:
                subscription_data = data.get("subscription")
                subscription_data = subscription_data if isinstance(subscription_data, dict) else {}
                subscription_code = subscription_data.get("subscription_code") or data.get("subscription_code")
                if subscription_code:
                    if event_type == "invoice.payment_failed":
                        connection.execute(
                            """UPDATE billing_subscriptions SET status = 'past_due', updated_at = now()
                               WHERE provider = 'paystack' AND provider_subscription_id = %s""",
                            (str(subscription_code),),
                        )
                    elif data.get("status") in {"success", "paid"}:
                        connection.execute(
                            """UPDATE billing_subscriptions
                               SET status = 'active',
                                   current_period_start = COALESCE(%s, current_period_start),
                                   current_period_end = COALESCE(%s, current_period_end),
                                   updated_at = now()
                               WHERE provider = 'paystack' AND provider_subscription_id = %s""",
                            (
                                parse_provider_datetime(data.get("period_start")),
                                parse_provider_datetime(data.get("period_end")),
                                str(subscription_code),
                            ),
                        )
            elif event_type == "subscription.not_renew":
                code = data.get("subscription_code")
                if code:
                    connection.execute(
                        """UPDATE billing_subscriptions
                           SET cancel_at_period_end = true, updated_at = now()
                           WHERE provider = 'paystack' AND provider_subscription_id = %s""",
                        (str(code),),
                    )
            elif event_type == "subscription.disable":
                code = data.get("subscription_code")
                if code:
                    connection.execute(
                        """UPDATE billing_subscriptions
                           SET status = 'cancelled', cancel_at_period_end = false, updated_at = now()
                           WHERE provider = 'paystack' AND provider_subscription_id = %s""",
                        (str(code),),
                    )

    @app.post("/api/billing/webhooks/stripe")
    async def stripe_billing_webhook(request: Request) -> Dict[str, str]:
        if not settings.stripe_webhook_secret:
            raise ApiError(503, "webhook_not_configured", "Stripe webhooks are not configured.")
        payload = await request.body()
        signature = request.headers.get("stripe-signature", "")
        if not verify_stripe_signature(payload, signature, settings.stripe_webhook_secret):
            raise ApiError(400, "invalid_webhook_signature", "The payment signature is invalid.")
        try:
            event = json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ApiError(400, "invalid_webhook", "The payment event is invalid.") from error
        if not isinstance(event, dict) or not isinstance(event.get("id"), str):
            raise ApiError(400, "invalid_webhook", "The payment event is invalid.")
        process_stripe_event(event)
        return {"received": "true"}

    @app.post("/api/billing/webhooks/paystack")
    async def paystack_billing_webhook(request: Request) -> Dict[str, str]:
        if not settings.paystack_secret_key:
            raise ApiError(503, "webhook_not_configured", "Paystack webhooks are not configured.")
        payload = await request.body()
        signature = request.headers.get("x-paystack-signature", "")
        if not verify_paystack_signature(payload, signature, settings.paystack_secret_key):
            raise ApiError(400, "invalid_webhook_signature", "The payment signature is invalid.")
        try:
            event = json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ApiError(400, "invalid_webhook", "The payment event is invalid.") from error
        if not isinstance(event, dict) or not isinstance(event.get("event"), str):
            raise ApiError(400, "invalid_webhook", "The payment event is invalid.")
        process_paystack_event(event)
        return {"received": "true"}

    def require_livekit() -> None:
        if not (
            settings.livekit_url
            and settings.livekit_api_key
            and settings.livekit_api_secret
        ):
            raise ApiError(
                503,
                "live_video_not_configured",
                "Live video is not configured on this server yet.",
            )

    @app.get("/api/live")
    def list_live_streams(request: Request) -> Dict[str, Any]:
        require_user(request)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT stream.id, stream.title, stream.created_at, stream.host_id,
                          host.display_name, host.username, host.profile_image_url
                   FROM live_streams stream
                   JOIN users host ON host.id = stream.host_id
                   WHERE stream.status = 'live'
                     AND stream.last_heartbeat_at > now() - interval '90 seconds'
                   ORDER BY stream.created_at DESC, stream.id DESC
                   LIMIT 100"""
            ).fetchall()
        return {"streams": [public_live_stream(row) for row in rows]}

    @app.post("/api/live", status_code=201)
    def create_live_stream(
        input: LiveStreamInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        require_livekit()
        room_name = uuid4().hex
        with database.connection() as connection:
            connection.execute(
                """UPDATE live_streams
                   SET status = 'ended', ended_at = now()
                   WHERE host_id = %s AND status = 'live'
                     AND last_heartbeat_at <= now() - interval '90 seconds'""",
                (user["id"],),
            )
            existing = connection.execute(
                "SELECT id FROM live_streams WHERE host_id = %s AND status = 'live'",
                (user["id"],),
            ).fetchone()
            if existing:
                raise ApiError(409, "live_stream_already_active", "End your current live stream before starting another.")
            row = connection.execute(
                """INSERT INTO live_streams (host_id, title, room_name)
                   VALUES (%s, %s, %s)
                   RETURNING id, title, created_at, host_id""",
                (user["id"], input.title, room_name),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "Your live stream could not be started.")
        row = {
            **row,
            "display_name": user["display_name"],
            "username": user["username"],
            "profile_image_url": user.get("profile_image_url"),
        }
        return {
            "stream": public_live_stream(row),
            "serverUrl": settings.livekit_url,
            "token": live_stream_access_token(
                settings,
                user["id"],
                user["display_name"],
                room_name,
                True,
            ),
        }

    @app.post("/api/live/{stream_id}/join")
    def join_live_stream(stream_id: UUID, request: Request) -> Dict[str, Any]:
        user = require_user(request)
        require_livekit()
        with database.connection() as connection:
            row = connection.execute(
                """SELECT stream.id, stream.title, stream.room_name, stream.created_at,
                          stream.host_id, host.display_name, host.username, host.profile_image_url
                   FROM live_streams stream
                   JOIN users host ON host.id = stream.host_id
                   WHERE stream.id = %s AND stream.status = 'live'
                     AND stream.last_heartbeat_at > now() - interval '90 seconds'""",
                (stream_id,),
            ).fetchone()
        if not row:
            raise ApiError(404, "live_stream_not_found", "That live stream has ended or could not be found.")
        return {
            "stream": public_live_stream(row),
            "serverUrl": settings.livekit_url,
            "token": live_stream_access_token(
                settings,
                user["id"],
                user["display_name"],
                row["room_name"],
                str(row["host_id"]) == str(user["id"]),
            ),
            "isHost": str(row["host_id"]) == str(user["id"]),
        }

    @app.post("/api/live/{stream_id}/end", status_code=204)
    def end_live_stream(stream_id: UUID, request: Request) -> Response:
        user = require_user(request)
        with database.connection() as connection:
            ended = connection.execute(
                """UPDATE live_streams
                   SET status = 'ended', ended_at = now()
                   WHERE id = %s AND host_id = %s AND status = 'live'
                   RETURNING id""",
                (stream_id, user["id"]),
            ).fetchone()
        if not ended:
            raise ApiError(404, "live_stream_not_found", "That live stream could not be found.")
        publish_realtime({"type": "live.ended", "streamId": str(stream_id)})
        return Response(status_code=204)

    @app.post("/api/live/{stream_id}/heartbeat", status_code=204)
    def heartbeat_live_stream(stream_id: UUID, request: Request) -> Response:
        user = require_user(request)
        with database.connection() as connection:
            heartbeat = connection.execute(
                """UPDATE live_streams
                   SET last_heartbeat_at = now()
                   WHERE id = %s AND host_id = %s AND status = 'live'
                   RETURNING id""",
                (stream_id, user["id"]),
            ).fetchone()
        if not heartbeat:
            raise ApiError(404, "live_stream_not_found", "That live stream could not be found.")
        return Response(status_code=204)

    @app.post("/api/videos", status_code=201)
    async def create_video(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        enforce_media_upload_rate_limit(request)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type not in {"video/mp4", "video/webm"}:
            raise ApiError(400, "invalid_video", "Choose an MP4 or WebM video.")
        try:
            title = unquote(request.headers.get("x-video-title", ""), errors="strict").strip()
            caption = unquote(request.headers.get("x-video-caption", ""), errors="strict").strip()
        except UnicodeDecodeError as error:
            raise ApiError(400, "invalid_video", "Video details contain invalid text.") from error
        if not title or len(title) > 120 or len(caption) > 500:
            raise ApiError(400, "invalid_video", "Add a title (up to 120 characters) and a caption up to 500 characters.")

        filename = uuid4().hex + (".mp4" if content_type == "video/mp4" else ".webm")
        temporary_path = videos_directory / (filename + ".uploading")
        video_path = videos_directory / filename
        total_size = 0
        signature = bytearray()
        try:
            await asyncio.to_thread(videos_directory.mkdir, parents=True, exist_ok=True)
            with temporary_path.open("xb") as output:
                async for chunk in request.stream():
                    if not chunk:
                        continue
                    total_size += len(chunk)
                    if total_size > MAX_VIDEO_BYTES:
                        raise ApiError(413, "video_too_large", "Videos must be 250 MB or smaller.")
                    if len(signature) < 16:
                        signature.extend(chunk[:16 - len(signature)])
                    output.write(chunk)
            valid_signature = (
                len(signature) >= 12 and signature[4:8] == b"ftyp"
                if content_type == "video/mp4"
                else signature.startswith(b"\x1a\x45\xdf\xa3")
            )
            if not total_size or not valid_signature:
                raise ApiError(400, "invalid_video", "The uploaded file does not match its video format.")
            await asyncio.to_thread(temporary_path.replace, video_path)
            with database.connection() as connection:
                inserted = connection.execute(
                    """INSERT INTO videos (user_id, title, caption, filename, content_type, file_size)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       RETURNING id""",
                    (user["id"], title, caption, filename, content_type, total_size),
                ).fetchone()
                if not inserted:
                    raise ApiError(500, "internal_error", "The video could not be published.")
                record_posting_usage(connection, user["id"], "videos", inserted["id"])
                row = connection.execute(
                    """SELECT video.id, video.user_id, video.title, video.caption,
                              video.filename, video.content_type, video.file_size, video.created_at,
                              author.display_name, author.username, author.profile_image_url
                       FROM videos video
                       JOIN users author ON author.id = video.user_id
                       WHERE video.id = %s""",
                    (inserted["id"],),
                ).fetchone()
        except ApiError:
            temporary_path.unlink(missing_ok=True)
            if video_path.exists():
                video_path.unlink(missing_ok=True)
            raise
        except OSError as error:
            temporary_path.unlink(missing_ok=True)
            if video_path.exists():
                video_path.unlink(missing_ok=True)
            logger.exception("Could not save an uploaded video for user %s", user["id"])
            raise ApiError(500, "media_unavailable", "The video could not be saved. Check server media storage.") from error
        except Exception:
            temporary_path.unlink(missing_ok=True)
            if video_path.exists():
                video_path.unlink(missing_ok=True)
            raise
        if not row:
            video_path.unlink(missing_ok=True)
            raise ApiError(500, "internal_error", "The published video could not be loaded.")
        publish_realtime({"type": "video.created", "videoId": str(row["id"])})
        return {"video": public_video(row)}

    @app.get("/api/videos")
    def list_videos(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        view: Literal["all", "mine"] = "all",
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = []
        parameters: List[Any] = []
        if view == "mine":
            filters.append("video.user_id = %s")
            parameters.append(user["id"])
        if normalized_query:
            filters.append("strpos(lower(video.title || ' ' || video.caption || ' ' || author.display_name), %s) > 0")
            parameters.append(normalized_query)
        parameters.append(limit)
        where_clause = " AND ".join(filters) if filters else "TRUE"
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT video.id, video.user_id, video.title, video.caption,
                          video.filename, video.content_type, video.file_size, video.created_at,
                          author.display_name, author.username, author.profile_image_url
                   FROM videos video
                   JOIN users author ON author.id = video.user_id
                   WHERE {}
                   ORDER BY video.created_at DESC, video.id DESC
                   LIMIT %s""".format(where_clause),
                tuple(parameters),
            ).fetchall()
        return {"videos": [public_video(row) for row in rows]}

    @app.get("/api/videos/{video_id}/stream")
    def stream_video(video_id: UUID, request: Request) -> Response:
        require_user(request)
        with database.connection() as connection:
            video = connection.execute(
                "SELECT filename, content_type FROM videos WHERE id = %s",
                (video_id,),
            ).fetchone()
        if not video:
            raise ApiError(404, "video_not_found", "That video could not be found.")
        video_path = videos_directory / video["filename"]
        if not video_path.is_file():
            raise ApiError(404, "video_not_found", "That video file is no longer available.")
        return FileResponse(
            video_path,
            media_type=video["content_type"],
            headers={"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"},
        )

    @app.delete("/api/videos/{video_id}", status_code=204)
    def delete_video(video_id: UUID, request: Request) -> Response:
        user = require_user(request)
        with database.connection() as connection:
            removed = connection.execute(
                "DELETE FROM videos WHERE id = %s AND user_id = %s RETURNING filename",
                (video_id, user["id"]),
            ).fetchone()
        if not removed:
            raise ApiError(404, "video_not_found", "That video could not be found.")
        try:
            (videos_directory / removed["filename"]).unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not remove video media %s for user %s", video_id, user["id"])
            raise ApiError(500, "media_unavailable", "The video record was removed, but its media file could not be deleted.")
        return Response(status_code=204)

    @app.get("/api/health")
    def health() -> Dict[str, str]:
        with database.connection() as connection:
            connection.execute("SELECT 1")
        return {"status": "ok"}

    @app.post("/api/auth/register", status_code=202, dependencies=[Depends(enforce_auth_rate_limit)])
    def register(input: RegisterInput) -> Dict[str, str]:
        password_hash = hash_password(input.password)
        email_prefix = re.sub(r"[^a-zA-Z0-9._]", "", input.email.split("@")[0])[:30]
        username = email_prefix if len(email_prefix) >= 3 else ("user" + email_prefix)[:30]
        with database.connection() as connection:
            user = connection.execute(
                """INSERT INTO users (display_name, username, email, password_hash)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (email) DO NOTHING
                   RETURNING id, display_name, email""",
                (input.name, username, input.email, password_hash),
            ).fetchone()
        if user:
            issue_verification(user)
        return {"message": "If this address can be registered, a verification code has been sent."}

    @app.post("/api/auth/resend-verification", status_code=202, dependencies=[Depends(enforce_auth_rate_limit)])
    def resend_verification(input: ResendInput) -> Dict[str, str]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, email FROM users
                   WHERE email = %s AND email_verified_at IS NULL""",
                (input.email,),
            ).fetchone()
        if user:
            issue_verification(user)
        return {"message": "If the address is awaiting verification, a code has been sent."}

    @app.post("/api/auth/verify-email", dependencies=[Depends(enforce_auth_rate_limit)])
    def verify_email(input: VerifyInput, request: Request, response: Response) -> Dict[str, Any]:
        user = None
        invalid_code = False
        with database.connection() as connection:
            with connection.transaction():
                row = connection.execute(
                    """SELECT u.id, u.display_name, u.username, u.email, u.bio, u.interests,
                              v.code_hash, v.expires_at, v.attempts
                       FROM users u
                       JOIN email_verification_codes v ON v.user_id = u.id
                       WHERE u.email = %s AND u.email_verified_at IS NULL
                       FOR UPDATE OF u, v""",
                    (input.email,),
                ).fetchone()
                if not row:
                    invalid_code = True
                elif row["attempts"] >= 5 or row["expires_at"] <= datetime.now(timezone.utc):
                    connection.execute(
                        "DELETE FROM email_verification_codes WHERE user_id = %s",
                        (row["id"],),
                    )
                    invalid_code = True
                elif not secure_hash_equals(
                    hash_email_code(input.code, settings.otp_hash_secret),
                    row["code_hash"],
                ):
                    connection.execute(
                        "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = %s",
                        (row["id"],),
                    )
                    invalid_code = True
                else:
                    connection.execute(
                        "UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = %s",
                        (row["id"],),
                    )
                    connection.execute(
                        "DELETE FROM email_verification_codes WHERE user_id = %s",
                        (row["id"],),
                    )
                    user = row
        if invalid_code or not user:
            raise ApiError(
                400,
                "invalid_code",
                "That code is invalid or expired. Request a new one and try again.",
            )
        create_session(user["id"], request, response)
        return {"user": public_user(user)}

    @app.post("/api/auth/login", dependencies=[Depends(enforce_auth_rate_limit)])
    def login(input: LoginInput, request: Request, response: Response) -> Dict[str, Any]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, username, email, bio, interests,
                           profile_image_url,
                          profile_visible, discoverable,
                          password_hash, email_verified_at, suspended_at
                   FROM users WHERE email = %s""",
                (input.email,),
            ).fetchone()
        password_valid = verify_password(
            input.password,
            user["password_hash"] if user else dummy_password_hash,
        )
        if not user or not password_valid:
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        if not user["email_verified_at"]:
            raise ApiError(403, "email_not_verified", "Verify your email address before signing in.")
        if user["suspended_at"] is not None:
            raise ApiError(403, "account_suspended", "This account is currently suspended.")
        create_session(user["id"], request, response)
        return {"user": public_user(user)}

    @app.post("/api/admin/login", dependencies=[Depends(enforce_auth_rate_limit)])
    def admin_login(input: LoginInput, request: Request, response: Response) -> Dict[str, Any]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, username, email, bio, interests,
                           profile_image_url,
                          profile_visible, discoverable,
                          password_hash, email_verified_at, suspended_at
                   FROM users WHERE email = %s""",
                (input.email,),
            ).fetchone()
        password_valid = verify_password(
            input.password,
            user["password_hash"] if user else dummy_password_hash,
        )
        if not user or not password_valid:
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        if not user["email_verified_at"]:
            raise ApiError(403, "email_not_verified", "Verify your email address before signing in.")
        if user["suspended_at"] is not None:
            raise ApiError(403, "account_suspended", "This account is currently suspended.")
        role = None
        if user["email"].strip().lower() not in settings.admin_emails:
            with database.connection() as connection:
                role = connection.execute(
                    "SELECT user_id FROM admin_roles WHERE user_id = %s",
                    (user["id"],),
                ).fetchone()
        if user["email"].strip().lower() not in settings.admin_emails and not role:
            raise ApiError(403, "admin_required", "This account is not authorized to access admin tools.")
        admin_role = (
            "super_admin"
            if user["email"].strip().lower() in settings.admin_emails
            else "sub_admin"
        )
        create_session(user["id"], request, response)
        return {
            "admin": {
                "id": str(user["id"]),
                "name": user["display_name"],
                "email": user["email"],
                "role": admin_role,
            },
        }

    @app.get("/api/auth/me")
    def get_current_user(request: Request) -> Dict[str, Any]:
        return {"user": public_user(require_user(request))}

    @app.put("/api/auth/preferences")
    def update_privacy_preferences(
        input: PrivacyPreferencesInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE users
                   SET profile_visible = %s,
                       discoverable = %s,
                       updated_at = now()
                   WHERE id = %s AND email_verified_at IS NOT NULL
                   RETURNING profile_visible, discoverable""",
                (input.profile_visible, input.discoverable, user["id"]),
            ).fetchone()
        if not updated:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return {
            "preferences": {
                "profileVisible": updated["profile_visible"],
                "discoverable": updated["discoverable"],
            },
        }

    @app.put("/api/auth/profile")
    def update_profile(input: ProfileInput, request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE users
                   SET display_name = %s, username = %s, bio = %s, interests = %s, updated_at = now()
                   WHERE id = %s AND email_verified_at IS NOT NULL
                   RETURNING id, display_name, username, email, bio, interests,
                             profile_image_url,
                             profile_visible, discoverable""",
                (input.name, input.username, input.bio, input.interests, user["id"]),
            ).fetchone()
        if not updated:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return {"user": public_user(updated)}

    @app.put("/api/auth/profile/photo")
    def update_profile_photo(
        input: ProfilePhotoInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE users
                   SET profile_image_url = %s, updated_at = now()
                   WHERE id = %s AND email_verified_at IS NOT NULL
                   RETURNING id, display_name, username, email, bio, interests,
                             profile_image_url, profile_visible, discoverable""",
                (input.image_url, user["id"]),
            ).fetchone()
        if not updated:
            raise ApiError(401, "not_authenticated", "Sign in to continue.")
        return {"user": public_user(updated)}

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request, response: Response) -> Response:
        token = request.cookies.get(cookie_name)
        if token:
            with database.connection() as connection:
                connection.execute(
                    "DELETE FROM auth_sessions WHERE token_hash = %s",
                    (hash_session_token(token, settings.session_secret),),
                )
        response.delete_cookie(
            cookie_name,
            httponly=True,
            secure=settings.production,
            samesite="lax",
            path="/",
        )
        response.status_code = 204
        return response

    @app.get("/api/admin/me")
    def get_admin_session(admin: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
        return {
            "admin": {
                "id": str(admin["id"]),
                "name": admin["display_name"],
                "email": admin["email"],
                "role": admin["role"],
            },
        }

    @app.get("/api/admin/subadmins")
    def list_admin_subadmins(
        _admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT u.id, u.display_name, u.email, roles.created_at,
                          creator.display_name AS created_by_name
                   FROM admin_roles roles
                   JOIN users u ON u.id = roles.user_id
                   JOIN users creator ON creator.id = roles.created_by
                   ORDER BY roles.created_at DESC, u.id""",
            ).fetchall()
        return {
            "superAdmins": sorted(settings.admin_emails),
            "subAdmins": [
                {
                    "id": str(row["id"]),
                    "name": row["display_name"],
                    "email": row["email"],
                    "createdAt": row["created_at"].isoformat(),
                    "createdBy": row["created_by_name"],
                }
                for row in rows
            ],
        }

    @app.post("/api/admin/subadmins", status_code=201)
    def create_admin_subadmin(
        input: AdminSubadminInput,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        if input.email in settings.admin_emails:
            raise ApiError(409, "admin_already_exists", "This account is already a super administrator.")
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, email, email_verified_at
                   FROM users WHERE lower(email) = %s""",
                (input.email,),
            ).fetchone()
            if not user:
                raise ApiError(404, "user_not_found", "Register and verify this account before granting admin access.")
            if not user["email_verified_at"]:
                raise ApiError(409, "email_not_verified", "Verify this account’s email before granting admin access.")
            existing = connection.execute(
                "SELECT user_id FROM admin_roles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
            if existing:
                raise ApiError(409, "admin_already_exists", "This account is already a sub-admin.")
            connection.execute(
                "INSERT INTO admin_roles (user_id, created_by) VALUES (%s, %s)",
                (user["id"], admin["id"]),
            )
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'grant_subadmin', %s::jsonb)""",
                (admin["id"], user["id"], json.dumps({"email": user["email"]})),
            )
        return {
            "subAdmin": {
                "id": str(user["id"]),
                "name": user["display_name"],
                "email": user["email"],
            },
        }

    @app.delete("/api/admin/subadmins/{user_id}", status_code=204)
    def delete_admin_subadmin(
        user_id: UUID,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Response:
        with database.connection() as connection:
            removed = connection.execute(
                """DELETE FROM admin_roles roles
                   USING users u
                   WHERE roles.user_id = %s AND u.id = roles.user_id
                     AND lower(u.email) <> ALL(%s)
                   RETURNING roles.user_id, u.email""",
                (user_id, list(settings.admin_emails)),
            ).fetchone()
            if not removed:
                raise ApiError(404, "subadmin_not_found", "That sub-admin could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'revoke_subadmin', %s::jsonb)""",
                (admin["id"], user_id, json.dumps({"email": removed["email"]})),
            )
        return Response(status_code=204)

    @app.get("/api/admin/content")
    def list_admin_content(
        content_type: Literal["posts", "comments", "products", "local_listings", "jobs", "communities"] = Query(alias="type"),
        query: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        pattern = "%" + escaped_query + "%" if escaped_query else None
        definitions = {
            "posts": (
                "social_posts p JOIN users u ON u.id = p.user_id",
                "p.id, p.body AS title, u.display_name AS owner, p.created_at, p.image_urls AS image_urls, TRUE AS published",
                "lower(p.body) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "social_posts",
            ),
            "comments": (
                "social_post_comments c JOIN users u ON u.id = c.user_id JOIN social_posts p ON p.id = c.post_id",
                "c.id, c.body AS title, u.display_name AS owner, c.created_at, '{}'::text[] AS image_urls, TRUE AS published",
                "lower(c.body) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "social_post_comments",
            ),
            "products": (
                "marketplace_products p JOIN users u ON u.id = p.seller_id",
                "p.id, p.name AS title, p.description, p.category, p.price, p.stock, p.image_url, u.display_name AS owner, p.created_at, COALESCE(NULLIF(p.image_urls, '{}'::text[]), CASE WHEN p.image_url IS NOT NULL THEN ARRAY[p.image_url]::text[] ELSE '{}'::text[] END) AS image_urls, p.published",
                "lower(p.name) LIKE %s ESCAPE E'\\\\' OR lower(p.description) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "marketplace_products",
            ),
            "local_listings": (
                "local_marketplace_listings p JOIN users u ON u.id = p.seller_id",
                "p.id, p.title, concat(p.category, ' · ', p.location, ' · ', p.price, ' · ', p.description) AS description, u.display_name AS owner, p.created_at, CASE WHEN p.image_url IS NOT NULL THEN ARRAY[p.image_url]::text[] ELSE '{}'::text[] END AS image_urls, p.published",
                "lower(p.title) LIKE %s ESCAPE E'\\\\' OR lower(p.description) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "local_marketplace_listings",
            ),
            "jobs": (
                "job_listings p JOIN users u ON u.id = p.user_id",
                "p.id, p.title, concat(p.company, ' · ', p.location, ' · ', p.description) AS description, u.display_name AS owner, p.created_at, CASE WHEN p.company_image_url IS NOT NULL THEN ARRAY[p.company_image_url]::text[] ELSE '{}'::text[] END AS image_urls, TRUE AS published",
                "lower(p.title) LIKE %s ESCAPE E'\\\\' OR lower(p.company) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "job_listings",
            ),
            "communities": (
                "communities p JOIN users u ON u.id = p.owner_id",
                "p.id, p.name AS title, p.description, u.display_name AS owner, p.created_at, ARRAY[]::text[] AS image_urls, TRUE AS published",
                "lower(p.name) LIKE %s ESCAPE E'\\\\' OR lower(p.description) LIKE %s ESCAPE E'\\\\' OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'",
                "communities",
            ),
        }
        source, fields, search_clause, _ = definitions[content_type]
        sort_alias = {
            "posts": "p",
            "comments": "c",
            "products": "p",
            "local_listings": "p",
            "jobs": "p",
            "communities": "p",
        }[content_type]
        where_clause = "WHERE %s::text IS NULL OR (" + search_clause + ")"
        parameters = (pattern, *([pattern] * search_clause.count("%s")))
        with database.connection() as connection:
            total = connection.execute(
                "SELECT count(*) AS total FROM {} {}".format(source, where_clause),
                parameters,
            ).fetchone()
            rows = connection.execute(
                "SELECT {} FROM {} {} ORDER BY {}.created_at DESC, {}.id DESC LIMIT %s OFFSET %s".format(
                    fields, source, where_clause, sort_alias, sort_alias
                ),
                (*parameters, limit, offset),
            ).fetchall()
        return {
            "items": [
                {
                    "id": str(row["id"]),
                    "title": row["title"],
                    "description": row.get("description", ""),
                    "owner": row["owner"],
                    "createdAt": row["created_at"].isoformat(),
                    "imageUrls": row.get("image_urls") or [],
                    "published": bool(row["published"]),
                    **(
                        {
                            "category": row["category"],
                            "price": int(row["price"]),
                            "stock": int(row["stock"]),
                            "imageUrl": row["image_url"],
                        }
                        if content_type == "products"
                        else {}
                    ),
                }
                for row in rows
            ],
            "total": int(total["total"]) if total else 0,
            "limit": limit,
            "offset": offset,
        }

    @app.delete("/api/admin/content/{content_type}/{content_id}", status_code=204)
    def delete_admin_content(
        content_type: Literal["posts", "comments", "products", "local_listings", "jobs", "communities"],
        content_id: UUID,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Response:
        tables = {
            "posts": ("social_posts", "user_id"),
            "comments": ("social_post_comments", "user_id"),
            "products": ("marketplace_products", "seller_id"),
            "local_listings": ("local_marketplace_listings", "seller_id"),
            "jobs": ("job_listings", "user_id"),
            "communities": ("communities", "owner_id"),
        }
        table, owner_column = tables[content_type]
        with database.connection() as connection:
            removed = connection.execute(
                "DELETE FROM {} WHERE id = %s RETURNING {}, id".format(table, owner_column),
                (content_id,),
            ).fetchone()
            if not removed:
                raise ApiError(404, "content_not_found", "That content could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'delete_content', %s::jsonb)""",
                (
                    admin["id"],
                    removed[owner_column],
                    json.dumps({"type": content_type, "id": str(removed["id"])}),
                ),
            )
        return Response(status_code=204)

    @app.post("/api/admin/posts", status_code=201)
    def create_admin_post(
        input: SocialPostInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO social_posts (user_id, body, image_urls)
                   VALUES (%s, %s, %s)
                   RETURNING id""",
                (admin["id"], input.text, input.image_urls),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The post could not be published.")
            post = social_post(connection, inserted["id"], admin["id"])
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'create_admin_content', %s::jsonb)""",
                (
                    admin["id"],
                    json.dumps({"type": "post", "id": str(inserted["id"])}),
                ),
            )
        if not post:
            raise ApiError(500, "internal_error", "The post could not be loaded.")
        publish_realtime({"type": "post.created", "postId": str(post["id"])})
        return {"post": public_social_post(post, admin["id"])}

    @app.put("/api/admin/posts/{post_id}")
    def update_admin_post(
        post_id: UUID,
        input: SocialPostInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE social_posts
                   SET body = %s, image_urls = %s
                   WHERE id = %s
                   RETURNING id, user_id, created_at""",
                (input.text, input.image_urls, post_id),
            ).fetchone()
            if not updated:
                raise ApiError(404, "content_not_found", "That post could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'edit_user_post', %s::jsonb)""",
                (
                    admin["id"],
                    updated["user_id"],
                    json.dumps({"type": "post", "id": str(post_id)}),
                ),
            )
        return {
            "post": {
                "id": str(updated["id"]),
                "text": input.text,
                "imageUrls": input.image_urls,
                "createdAt": updated["created_at"].isoformat(),
            },
        }

    @app.put("/api/admin/products/{product_id}")
    def update_admin_product(
        product_id: UUID,
        input: AdminMarketplaceProductInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        image_urls = input.image_urls or ([input.image_url] if input.image_url else [])
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE marketplace_products
                   SET name = %s, category = %s, price = %s, stock = %s,
                       description = %s, image_url = %s, image_urls = %s, published = %s
                   WHERE id = %s
                   RETURNING id""",
                (
                    input.name,
                    input.category,
                    input.price,
                    input.stock,
                    input.description,
                    input.image_url or (image_urls[0] if image_urls else None),
                    image_urls,
                    input.published,
                    product_id,
                ),
            ).fetchone()
            if not updated:
                raise ApiError(404, "product_not_found", "That product could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_product', %s::jsonb)""",
                (admin["id"], json.dumps({"productId": str(product_id), "published": input.published})),
            )
        return {"productId": str(product_id), "published": input.published}

    @app.post("/api/admin/products", status_code=201)
    def create_admin_product(
        input: AdminMarketplaceProductInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        image_urls = input.image_urls or ([input.image_url] if input.image_url else [])
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO marketplace_products
                       (seller_id, name, category, price, stock, description, image_url, image_urls, published)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    admin["id"],
                    input.name,
                    input.category,
                    input.price,
                    input.stock,
                    input.description,
                    image_urls[0] if image_urls else None,
                    image_urls,
                    input.published,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The product could not be published.")
            row = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE p.id = %s""",
                (inserted["id"],),
            ).fetchone()
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'create_admin_content', %s::jsonb)""",
                (
                    admin["id"],
                    json.dumps({"type": "product", "id": str(inserted["id"])}),
                ),
            )
        if not row:
            raise ApiError(500, "internal_error", "The product could not be loaded.")
        return {"product": public_marketplace_product(row)}

    @app.post("/api/admin/jobs", status_code=201)
    def create_admin_job(
        input: JobListingInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO job_listings
                       (user_id, title, company, location, employment_type,
                        workplace_type, summary, description, company_image_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    admin["id"],
                    input.title,
                    input.company,
                    input.location,
                    input.employment_type,
                    input.workplace_type,
                    input.summary,
                    input.description,
                    input.company_image_url,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The job could not be published.")
            row = job_record(connection, inserted["id"], admin["id"])
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'create_admin_content', %s::jsonb)""",
                (
                    admin["id"],
                    json.dumps({"type": "job", "id": str(inserted["id"])}),
                ),
            )
        if not row:
            raise ApiError(500, "internal_error", "The job could not be loaded.")
        return {"job": public_job(row)}

    @app.post("/api/admin/local-listings", status_code=201)
    def create_admin_local_listing(
        input: LocalMarketplaceListingInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO local_marketplace_listings
                       (seller_id, category, title, price, location, detail,
                        description, image_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    admin["id"],
                    input.category,
                    input.title,
                    input.price,
                    input.location,
                    input.detail,
                    input.description,
                    input.image_url,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The home listing could not be published.")
            row = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE l.id = %s""",
                (inserted["id"],),
            ).fetchone()
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'create_admin_content', %s::jsonb)""",
                (
                    admin["id"],
                    json.dumps({"type": "local_listing", "id": str(inserted["id"])}),
                ),
            )
        if not row:
            raise ApiError(500, "internal_error", "The home listing could not be loaded.")
        return {"listing": public_local_marketplace_listing(row)}

    @app.get("/api/admin/overview")
    def get_admin_overview(
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """SELECT
                       (SELECT count(*) FROM users) AS users,
                       (SELECT count(*) FROM users WHERE email_verified_at IS NOT NULL) AS verified_users,
                       (SELECT count(*) FROM social_posts) AS posts,
                       (SELECT count(*) FROM social_post_comments) AS comments,
                       (SELECT count(*) FROM social_post_likes) AS likes,
                       (SELECT count(*) FROM social_post_bookmarks) AS bookmarks,
                       (SELECT count(*) FROM direct_messages) AS messages,
                       (SELECT count(*) FROM marketplace_products) AS products,
                       (SELECT count(*) FROM local_marketplace_listings) AS local_listings,
                       (SELECT count(*) FROM job_listings) AS jobs,
                       (SELECT count(*) FROM job_applications) AS applications,
                       (SELECT count(*) FROM communities) AS communities,
                       (SELECT count(*) FROM community_memberships) AS memberships,
                       (SELECT count(*) FROM users WHERE created_at >= now() - interval '7 days') AS new_users_7d,
                       (SELECT count(*) FROM social_posts WHERE created_at >= now() - interval '7 days') AS new_posts_7d,
                       (SELECT count(*) FROM marketplace_products WHERE created_at >= now() - interval '7 days') AS new_products_7d,
                       (SELECT count(*) FROM job_listings WHERE created_at >= now() - interval '7 days') AS new_jobs_7d"""
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "Admin overview could not be loaded.")
        return {
            "overview": {
                "users": int(row["users"]),
                "verifiedUsers": int(row["verified_users"]),
                "posts": int(row["posts"]),
                "comments": int(row["comments"]),
                "likes": int(row["likes"]),
                "bookmarks": int(row["bookmarks"]),
                "messages": int(row["messages"]),
                "products": int(row["products"]),
                "localListings": int(row["local_listings"]),
                "jobs": int(row["jobs"]),
                "applications": int(row["applications"]),
                "communities": int(row["communities"]),
                "memberships": int(row["memberships"]),
                "newUsers7d": int(row["new_users_7d"]),
                "newPosts7d": int(row["new_posts_7d"]),
                "newProducts7d": int(row["new_products_7d"]),
                "newJobs7d": int(row["new_jobs_7d"]),
            },
        }

    @app.get("/api/admin/monetization")
    def get_admin_monetization(
        _admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            plans = connection.execute(
                """SELECT id, name, currency, amount_minor, posting_limits, active, country_codes
                   FROM subscription_plans ORDER BY currency, amount_minor, name"""
            ).fetchall()
            settings_row = connection.execute(
                """SELECT free_monthly_limits, free_daily_dating_likes,
                          marketplace_commission_bps
                   FROM posting_quota_settings WHERE id = 1"""
            ).fetchone()
            dating_products = connection.execute(
                """SELECT id, code, name, currency, amount_minor, quantity,
                          duration_hours, active
                   FROM dating_billing_products ORDER BY code, currency"""
            ).fetchall()
            revenue = connection.execute(
                """SELECT currency,
                          COALESCE(sum(amount_minor) FILTER (
                              WHERE paid_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                          ), 0) AS month_minor,
                          COALESCE(sum(amount_minor) FILTER (WHERE status = 'paid'), 0) AS all_time_minor,
                          count(*) FILTER (
                              WHERE status = 'paid'
                                AND paid_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                          ) AS paid_transactions
                   FROM billing_transactions
                   WHERE transaction_type <> 'marketplace_order'
                   GROUP BY currency ORDER BY currency"""
            ).fetchall()
            marketplace_revenue = connection.execute(
                """SELECT currency,
                          COALESCE(sum(amount_minor) FILTER (
                              WHERE paid_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                          ), 0) AS month_gross_minor,
                          COALESCE(sum(marketplace_commission_minor) FILTER (
                              WHERE paid_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                          ), 0) AS month_commission_minor,
                          COALESCE(sum(marketplace_commission_minor), 0) AS all_time_commission_minor,
                          COALESCE(sum(seller_amount_minor), 0) AS seller_payout_due_minor
                   FROM marketplace_orders
                   WHERE status IN ('paid', 'fulfilled')
                   GROUP BY currency"""
            ).fetchall()
            active_subscriptions = connection.execute(
                """SELECT currency, count(*) AS total
                   FROM billing_subscriptions
                   WHERE status = 'active'
                     AND (current_period_end IS NULL OR current_period_end > now())
                   GROUP BY currency"""
            ).fetchall()
        if not settings_row:
            raise ApiError(503, "billing_not_configured", "Monetization settings are unavailable.")
        free_limits = settings_row["free_monthly_limits"]
        if isinstance(free_limits, str):
            free_limits = json.loads(free_limits)
        return {
            "plans": [public_billing_plan(plan) for plan in plans],
            "settings": {
                "freeMonthlyLimits": {
                    category: int(free_limits.get(category, 0))
                    for category in ("jobs", "products", "marketplace", "videos")
                },
                "freeDailyDatingLikes": int(settings_row["free_daily_dating_likes"]),
                "marketplaceCommissionBps": int(settings_row["marketplace_commission_bps"]),
            },
            "datingProducts": [{
                "id": str(product["id"]),
                "code": product["code"],
                "name": product["name"],
                "currency": product["currency"],
                "amountMinor": int(product["amount_minor"]),
                "quantity": int(product["quantity"]),
                "durationHours": int(product["duration_hours"]),
                "active": bool(product["active"]),
            } for product in dating_products],
            "revenue": {
                row["currency"]: {
                    "thisMonthMinor": int(row["month_minor"]),
                    "allTimeMinor": int(row["all_time_minor"]),
                    "paidTransactions": int(row["paid_transactions"]),
                }
                for row in revenue
            },
            "marketplaceRevenue": {
                row["currency"]: {
                    "thisMonthGrossMinor": int(row["month_gross_minor"]),
                    "thisMonthCommissionMinor": int(row["month_commission_minor"]),
                    "allTimeCommissionMinor": int(row["all_time_commission_minor"]),
                    "sellerPayoutDueMinor": int(row["seller_payout_due_minor"]),
                }
                for row in marketplace_revenue
            },
            "activeSubscriptions": {
                row["currency"]: int(row["total"])
                for row in active_subscriptions
            },
        }

    @app.post("/api/admin/monetization/plans", status_code=201)
    def create_admin_subscription_plan(
        input: SubscriptionPlanInput,
        request: Request,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        posting_limits = {
            "jobs": input.jobs_limit,
            "products": input.products_limit,
            "marketplace": input.marketplace_limit,
            "videos": input.videos_limit,
        }
        with database.connection() as connection:
            row = connection.execute(
                """INSERT INTO subscription_plans
                       (name, currency, amount_minor, posting_limits, active, created_by, country_codes)
                   VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s)
                   RETURNING id, name, currency, amount_minor, posting_limits, active, country_codes""",
                (
                    input.name, input.currency, input.amount_minor,
                    json.dumps(posting_limits), input.active, admin["id"], input.country_codes,
                ),
            ).fetchone()
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_monetization', %s::jsonb)""",
                (admin["id"], json.dumps({"action": "create_plan", "plan_id": str(row["id"])})),
            )
        return {"plan": public_billing_plan(row)}

    @app.put("/api/admin/monetization/plans/{plan_id}")
    def update_admin_subscription_plan(
        plan_id: UUID,
        input: SubscriptionPlanInput,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        posting_limits = {
            "jobs": input.jobs_limit,
            "products": input.products_limit,
            "marketplace": input.marketplace_limit,
            "videos": input.videos_limit,
        }
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE subscription_plans
                   SET name = %s, currency = %s, amount_minor = %s,
                       posting_limits = %s::jsonb, active = %s, country_codes = %s,
                       paystack_plan_code = NULL, updated_at = now()
                   WHERE id = %s
                   RETURNING id, name, currency, amount_minor, posting_limits, active, country_codes""",
                (
                    input.name, input.currency, input.amount_minor,
                    json.dumps(posting_limits), input.active, input.country_codes, plan_id,
                ),
            ).fetchone()
            if not row:
                raise ApiError(404, "billing_plan_not_found", "That publisher plan could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_monetization', %s::jsonb)""",
                (admin["id"], json.dumps({"action": "update_plan", "plan_id": str(plan_id)})),
            )
        return {"plan": public_billing_plan(row)}

    @app.put("/api/admin/monetization/settings")
    def update_admin_monetization_settings(
        input: PostingQuotaSettingsInput,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        free_limits = {
            "jobs": input.free_jobs_limit,
            "products": input.free_products_limit,
            "marketplace": input.free_marketplace_limit,
            "videos": input.free_videos_limit,
        }
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE posting_quota_settings
                   SET free_monthly_limits = %s::jsonb,
                       free_daily_dating_likes = %s,
                       marketplace_commission_bps = %s,
                       updated_at = now()
                   WHERE id = 1
                   RETURNING free_monthly_limits, free_daily_dating_likes,
                             marketplace_commission_bps""",
                (
                    json.dumps(free_limits),
                    input.free_daily_dating_likes,
                    input.marketplace_commission_bps,
                ),
            ).fetchone()
            if not row:
                raise ApiError(503, "billing_not_configured", "Monetization settings are unavailable.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_monetization', %s::jsonb)""",
                (admin["id"], json.dumps({"action": "update_allowances", **free_limits,
                                          "free_daily_dating_likes": input.free_daily_dating_likes,
                                          "marketplace_commission_bps": input.marketplace_commission_bps})),
            )
        return {"settings": {
            "freeMonthlyLimits": free_limits,
            "freeDailyDatingLikes": input.free_daily_dating_likes,
            "marketplaceCommissionBps": int(row["marketplace_commission_bps"]),
        }}

    @app.put("/api/admin/monetization/dating-products/{product_id}")
    def update_admin_dating_billing_product(
        product_id: UUID,
        input: DatingBillingProductInput,
        admin: Dict[str, Any] = Depends(require_super_admin),
    ) -> Dict[str, Any]:
        if input.active and input.amount_minor <= 0:
            raise ApiError(400, "invalid_dating_product", "Set a price before enabling a dating add-on.")
        with database.connection() as connection:
            product = connection.execute(
                "SELECT code FROM dating_billing_products WHERE id = %s",
                (product_id,),
            ).fetchone()
            if not product:
                raise ApiError(404, "dating_product_not_found", "That dating add-on could not be found.")
            if product["code"] == "profile_boost" and input.duration_hours == 0:
                raise ApiError(400, "invalid_dating_product", "Profile boosts must have a positive duration.")
            row = connection.execute(
                """UPDATE dating_billing_products
                   SET name = %s, amount_minor = %s, quantity = %s,
                       duration_hours = %s, active = %s, updated_at = now()
                   WHERE id = %s
                   RETURNING id, code, name, currency, amount_minor, quantity,
                             duration_hours, active""",
                (
                    input.name, input.amount_minor, input.quantity,
                    input.duration_hours, input.active, product_id,
                ),
            ).fetchone()
            if not row:
                raise ApiError(404, "dating_product_not_found", "That dating add-on could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, action, details)
                   VALUES (%s, 'update_monetization', %s::jsonb)""",
                (admin["id"], json.dumps({"action": "update_dating_product",
                                          "product_id": str(product_id)})),
            )
        return {"datingProduct": {
            "id": str(row["id"]),
            "code": row["code"],
            "name": row["name"],
            "currency": row["currency"],
            "amountMinor": int(row["amount_minor"]),
            "quantity": int(row["quantity"]),
            "durationHours": int(row["duration_hours"]),
            "active": bool(row["active"]),
        }}

    @app.get("/api/admin/users")
    def list_admin_users(
        query: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = "%" + escaped_query + "%" if escaped_query else None
        with database.connection() as connection:
            total = connection.execute(
                """SELECT count(*) AS total
                   FROM users u
                   WHERE %s::text IS NULL
                      OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.username) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.email) LIKE %s ESCAPE E'\\\\'""",
                (pattern, pattern, pattern, pattern),
            ).fetchone()
            rows = connection.execute(
                """SELECT u.id, u.display_name, u.username, u.email, u.bio, u.profile_image_url,
                          u.interests, u.profile_visible, u.discoverable,
                          u.email_verified_at, u.suspended_at, u.created_at, u.updated_at,
                          (SELECT count(*) FROM social_posts p WHERE p.user_id = u.id) AS posts,
                          (SELECT count(*) FROM social_post_comments c WHERE c.user_id = u.id) AS comments,
                          (SELECT count(*) FROM direct_messages m
                           WHERE m.sender_id = u.id OR m.recipient_id = u.id) AS messages,
                          (SELECT count(*) FROM marketplace_products p WHERE p.seller_id = u.id) AS products,
                          (SELECT count(*) FROM local_marketplace_listings l WHERE l.seller_id = u.id) AS local_listings,
                          (SELECT count(*) FROM job_listings j WHERE j.user_id = u.id) AS jobs,
                          (SELECT count(*) FROM job_applications a WHERE a.applicant_id = u.id) AS applications
                   FROM users u
                   WHERE %s::text IS NULL
                      OR lower(u.display_name) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.username) LIKE %s ESCAPE E'\\\\'
                      OR lower(u.email) LIKE %s ESCAPE E'\\\\'
                   ORDER BY u.created_at DESC, u.id DESC
                   LIMIT %s OFFSET %s""",
                (pattern, pattern, pattern, pattern, limit, offset),
            ).fetchall()
        users = [
            {
                "id": str(user["id"]),
                "name": user["display_name"],
                "username": user["username"],
                "email": user["email"],
                "bio": user["bio"],
                "profileImageUrl": user.get("profile_image_url"),
                "interests": user["interests"],
                "profileVisible": bool(user["profile_visible"]),
                "discoverable": bool(user["discoverable"]),
                "emailVerified": user["email_verified_at"] is not None,
                "suspended": user["suspended_at"] is not None,
                "createdAt": user["created_at"].isoformat(),
                "updatedAt": user["updated_at"].isoformat(),
                "counts": {
                    "posts": int(user["posts"]),
                    "comments": int(user["comments"]),
                    "messages": int(user["messages"]),
                    "products": int(user["products"]),
                    "localListings": int(user["local_listings"]),
                    "jobs": int(user["jobs"]),
                    "applications": int(user["applications"]),
                },
            }
            for user in rows
        ]
        return {
            "users": users,
            "total": int(total["total"]) if total else 0,
            "limit": limit,
            "offset": offset,
        }

    @app.post("/api/admin/users/{user_id}/suspension")
    def set_admin_user_suspension(
        user_id: UUID,
        input: AdminUserStatusInput,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, bool]:
        if str(admin["id"]) == str(user_id):
            raise ApiError(409, "cannot_suspend_self", "You cannot suspend your own administrator account.")
        with database.connection() as connection:
            target = connection.execute(
                "SELECT id, email FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
            if not target:
                raise ApiError(404, "user_not_found", "That account could not be found.")
            if target["email"].strip().lower() in settings.admin_emails:
                raise ApiError(409, "cannot_suspend_admin", "Super-admin accounts cannot be suspended here.")
            target_admin = connection.execute(
                "SELECT user_id FROM admin_roles WHERE user_id = %s",
                (user_id,),
            ).fetchone()
            if target_admin:
                raise ApiError(409, "cannot_suspend_admin", "Administrator accounts cannot be suspended here.")
            if input.suspended:
                connection.execute(
                    "UPDATE users SET suspended_at = now(), updated_at = now() WHERE id = %s",
                    (user_id,),
                )
                connection.execute("DELETE FROM auth_sessions WHERE user_id = %s", (user_id,))
            else:
                connection.execute(
                    "UPDATE users SET suspended_at = NULL, updated_at = now() WHERE id = %s",
                    (user_id,),
                )
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'update_user_status', %s::jsonb)""",
                (admin["id"], user_id, json.dumps({"suspended": input.suspended})),
            )
        return {"suspended": input.suspended}

    @app.get("/api/admin/users/{user_id}")
    def get_admin_user_details(
        user_id: UUID,
        limit: int = Query(default=100, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            user = connection.execute(
                """SELECT id, display_name, username, email, bio, interests, profile_image_url,
                          profile_visible, discoverable, email_verified_at, suspended_at,
                          created_at, updated_at
                   FROM users
                   WHERE id = %s""",
                (user_id,),
            ).fetchone()
            if not user:
                raise ApiError(404, "user_not_found", "That account could not be found.")
            business_profile = connection.execute(
                "SELECT * FROM job_business_profiles WHERE user_id = %s",
                (user_id,),
            ).fetchone()
            target_is_admin = user["email"].strip().lower() in settings.admin_emails
            if not target_is_admin:
                target_is_admin = connection.execute(
                    "SELECT user_id FROM admin_roles WHERE user_id = %s",
                    (user_id,),
                ).fetchone() is not None

            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action)
                   VALUES (%s, %s, 'view_user_details')""",
                (admin["id"], user_id),
            )
            counts = connection.execute(
                """SELECT
                       (SELECT count(*) FROM social_posts WHERE user_id = %s) AS posts,
                       (SELECT count(*) FROM social_post_comments WHERE user_id = %s) AS comments,
                       (SELECT count(*) FROM social_post_likes WHERE user_id = %s) AS likes,
                       (SELECT count(*) FROM social_post_bookmarks WHERE user_id = %s) AS bookmarks,
                       (SELECT count(*) FROM direct_messages
                        WHERE sender_id = %s OR recipient_id = %s) AS messages,
                       (SELECT count(*) FROM marketplace_products WHERE seller_id = %s) AS products,
                       (SELECT count(*) FROM local_marketplace_listings WHERE seller_id = %s) AS local_listings,
                       (SELECT count(*) FROM job_listings WHERE user_id = %s) AS jobs,
                       (SELECT count(*) FROM job_applications WHERE applicant_id = %s) AS applications,
                       (SELECT count(*) FROM communities WHERE owner_id = %s) AS communities_created,
                       (SELECT count(*) FROM community_memberships WHERE user_id = %s) AS communities_joined,
                       (SELECT count(*) FROM user_follows WHERE follower_id = %s) AS following,
                       (SELECT count(*) FROM user_follows WHERE following_id = %s) AS followers""",
                (user_id,) * 14,
            ).fetchone()
            posts = connection.execute(
                """SELECT p.id, p.body, p.image_urls, p.created_at,
                          (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                          (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count
                   FROM social_posts p WHERE p.user_id = %s
                   ORDER BY p.created_at DESC, p.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            comments = connection.execute(
                """SELECT c.id, c.post_id, c.body, c.created_at, p.body AS post_text
                   FROM social_post_comments c
                   JOIN social_posts p ON p.id = c.post_id
                   WHERE c.user_id = %s
                   ORDER BY c.created_at DESC, c.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            likes = connection.execute(
                """SELECT l.created_at, p.id AS post_id, p.body AS post_text,
                          author.display_name AS author_name, author.username AS author_username
                   FROM social_post_likes l
                   JOIN social_posts p ON p.id = l.post_id
                   JOIN users author ON author.id = p.user_id
                   WHERE l.user_id = %s
                   ORDER BY l.created_at DESC, p.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            bookmarks = connection.execute(
                """SELECT b.created_at, p.id AS post_id, p.body AS post_text,
                          author.display_name AS author_name, author.username AS author_username
                   FROM social_post_bookmarks b
                   JOIN social_posts p ON p.id = b.post_id
                   JOIN users author ON author.id = p.user_id
                   WHERE b.user_id = %s
                   ORDER BY b.created_at DESC, p.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            messages = connection.execute(
                """SELECT m.id, m.conversation_id, m.body, m.image_url, m.audio_url, m.edited_at, m.created_at, m.read_at,
                          sender.id AS sender_id, sender.display_name AS sender_name,
                          sender.username AS sender_username,
                          recipient.id AS recipient_id, recipient.display_name AS recipient_name,
                          recipient.username AS recipient_username
                   FROM direct_messages m
                   JOIN users sender ON sender.id = m.sender_id
                   JOIN users recipient ON recipient.id = m.recipient_id
                   WHERE m.sender_id = %s OR m.recipient_id = %s
                   ORDER BY m.created_at DESC, m.id DESC LIMIT %s OFFSET %s""",
                (user_id, user_id, limit, offset),
            ).fetchall()
            products = connection.execute(
                """SELECT id, name, category, price, stock, description, image_url, image_urls,
                          published, created_at
                   FROM marketplace_products WHERE seller_id = %s
                   ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            local_listings = connection.execute(
                """SELECT id, category, title, price, location, detail, description,
                          image_url, published, created_at
                   FROM local_marketplace_listings WHERE seller_id = %s
                   ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            jobs = connection.execute(
                """SELECT id, title, company, location, employment_type,
                          workplace_type, summary, description, created_at, updated_at
                   FROM job_listings WHERE user_id = %s
                   ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            applications = connection.execute(
                """SELECT a.id, a.job_id, a.cover_letter, a.status, a.created_at,
                          j.title AS job_title, j.company AS job_company
                   FROM job_applications a
                   JOIN job_listings j ON j.id = a.job_id
                   WHERE a.applicant_id = %s
                   ORDER BY a.created_at DESC, a.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            communities_joined = connection.execute(
                """SELECT c.id, c.name, c.description, c.created_at AS joined_at,
                          (SELECT count(*) FROM community_memberships m
                           WHERE m.community_id = c.id) AS member_count
                   FROM community_memberships membership
                   JOIN communities c ON c.id = membership.community_id
                   WHERE membership.user_id = %s
                   ORDER BY membership.created_at DESC, c.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            communities_created = connection.execute(
                """SELECT c.id, c.name, c.description, c.created_at,
                          (SELECT count(*) FROM community_memberships m
                           WHERE m.community_id = c.id) AS member_count
                   FROM communities c WHERE c.owner_id = %s
                   ORDER BY c.created_at DESC, c.id DESC LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            following = connection.execute(
                """SELECT followed.id, followed.display_name, followed.username, f.created_at
                   FROM user_follows f JOIN users followed ON followed.id = f.following_id
                   WHERE f.follower_id = %s
                   ORDER BY f.created_at DESC, followed.id LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
            followers = connection.execute(
                """SELECT follower.id, follower.display_name, follower.username, f.created_at
                   FROM user_follows f JOIN users follower ON follower.id = f.follower_id
                   WHERE f.following_id = %s
                   ORDER BY f.created_at DESC, follower.id LIMIT %s OFFSET %s""",
                (user_id, limit, offset),
            ).fetchall()
        def timestamp(row: Dict[str, Any], key: str) -> Optional[str]:
            value = row.get(key)
            return value.isoformat() if value else None

        details = {
            "id": str(user["id"]),
            "name": user["display_name"],
            "username": user["username"],
            "email": user["email"],
            "profileImageUrl": user.get("profile_image_url"),
            "role": admin["role"],
            "isAdmin": target_is_admin,
            "bio": user["bio"],
            "interests": user["interests"],
            "profileVisible": bool(user["profile_visible"]),
            "discoverable": bool(user["discoverable"]),
            "emailVerified": user["email_verified_at"] is not None,
            "suspended": user["suspended_at"] is not None,
            "emailVerifiedAt": timestamp(user, "email_verified_at"),
            "createdAt": timestamp(user, "created_at"),
            "updatedAt": timestamp(user, "updated_at"),
            "businessProfile": public_job_business_profile(
                business_profile,
                "/api/admin/users/{}/business-document".format(user_id) if business_profile else None,
            ),
            "counts": {
                "posts": int(counts["posts"]),
                "comments": int(counts["comments"]),
                "likes": int(counts["likes"]),
                "bookmarks": int(counts["bookmarks"]),
                "messages": int(counts["messages"]),
                "products": int(counts["products"]),
                "localListings": int(counts["local_listings"]),
                "jobs": int(counts["jobs"]),
                "applications": int(counts["applications"]),
                "communitiesCreated": int(counts["communities_created"]),
                "communitiesJoined": int(counts["communities_joined"]),
                "following": int(counts["following"]),
                "followers": int(counts["followers"]),
            },
            "activity": {
                "posts": [
                    {"id": str(row["id"]), "text": row["body"], "imageUrls": row.get("image_urls") or [], "createdAt": timestamp(row, "created_at"), "likeCount": int(row["like_count"]), "commentCount": int(row["comment_count"])}
                    for row in posts
                ],
                "comments": [
                    {"id": str(row["id"]), "postId": str(row["post_id"]), "text": row["body"], "postText": row["post_text"], "createdAt": timestamp(row, "created_at")}
                    for row in comments
                ],
                "likes": [
                    {"postId": str(row["post_id"]), "postText": row["post_text"], "author": {"name": row["author_name"], "username": row["author_username"]}, "createdAt": timestamp(row, "created_at")}
                    for row in likes
                ],
                "bookmarks": [
                    {"postId": str(row["post_id"]), "postText": row["post_text"], "author": {"name": row["author_name"], "username": row["author_username"]}, "createdAt": timestamp(row, "created_at")}
                    for row in bookmarks
                ],
                "messages": [
                    {
                        "id": str(row["id"]),
                        "conversationId": str(row["conversation_id"]),
                        "text": row["body"],
                        "imageUrl": row.get("image_url"),
                        "audioUrl": (
                            "/api/admin/users/{}/voice-notes/{}".format(
                                user_id,
                                row["audio_url"].rsplit("/", 1)[-1],
                            )
                            if row.get("audio_url")
                            else None
                        ),
                        "editedAt": timestamp(row, "edited_at"),
                        "readAt": timestamp(row, "read_at"),
                        "sender": {
                            "id": str(row["sender_id"]),
                            "name": row["sender_name"],
                            "username": row["sender_username"],
                        },
                        "recipient": {
                            "id": str(row["recipient_id"]),
                            "name": row["recipient_name"],
                            "username": row["recipient_username"],
                        },
                        "createdAt": timestamp(row, "created_at"),
                    }
                    for row in messages
                ],
                "products": [
                    {"id": str(row["id"]), "name": row["name"], "category": row["category"], "price": int(row["price"]), "stock": row["stock"], "description": row["description"], "imageUrl": (row.get("image_urls") or [row["image_url"]])[0], "imageUrls": row.get("image_urls") or ([row["image_url"]] if row["image_url"] else []), "published": bool(row["published"]), "createdAt": timestamp(row, "created_at")}
                    for row in products
                ],
                "localListings": [
                    {"id": str(row["id"]), "category": row["category"], "title": row["title"], "price": row["price"], "location": row["location"], "detail": row["detail"], "description": row["description"], "imageUrl": row["image_url"], "published": bool(row["published"]), "createdAt": timestamp(row, "created_at")}
                    for row in local_listings
                ],
                "jobs": [
                    {"id": str(row["id"]), "title": row["title"], "company": row["company"], "location": row["location"], "employmentType": row["employment_type"], "workplaceType": row["workplace_type"], "summary": row["summary"], "description": row["description"], "createdAt": timestamp(row, "created_at"), "updatedAt": timestamp(row, "updated_at")}
                    for row in jobs
                ],
                "applications": [
                    {"id": str(row["id"]), "jobId": str(row["job_id"]), "jobTitle": row["job_title"], "company": row["job_company"], "coverLetter": row["cover_letter"], "status": row["status"], "createdAt": timestamp(row, "created_at")}
                    for row in applications
                ],
                "communitiesJoined": [
                    {"id": str(row["id"]), "name": row["name"], "description": row["description"], "memberCount": int(row["member_count"]), "joinedAt": timestamp(row, "joined_at")}
                    for row in communities_joined
                ],
                "communitiesCreated": [
                    {"id": str(row["id"]), "name": row["name"], "description": row["description"], "memberCount": int(row["member_count"]), "createdAt": timestamp(row, "created_at")}
                    for row in communities_created
                ],
                "following": [
                    {"id": str(row["id"]), "name": row["display_name"], "username": row["username"], "createdAt": timestamp(row, "created_at")}
                    for row in following
                ],
                "followers": [
                    {"id": str(row["id"]), "name": row["display_name"], "username": row["username"], "createdAt": timestamp(row, "created_at")}
                    for row in followers
                ],
            },
            "page": {"limit": limit, "offset": offset},
        }
        return {"user": details}

    @app.get("/api/admin/users/{user_id}/business-document")
    def get_admin_business_document(
        user_id: UUID,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Response:
        with database.connection() as connection:
            profile = connection.execute(
                """SELECT document_filename, document_content_type
                   FROM job_business_profiles WHERE user_id = %s""",
                (user_id,),
            ).fetchone()
            if not profile:
                raise ApiError(404, "business_document_not_found", "That account has not submitted a CAC document.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'view_business_document', %s::jsonb)""",
                (admin["id"], user_id, json.dumps({"type": "cac_document"})),
            )
        document_path = business_documents_directory / profile["document_filename"]
        if not document_path.is_file():
            raise ApiError(404, "business_document_not_found", "The submitted CAC document is no longer available.")
        return FileResponse(
            document_path,
            media_type=profile["document_content_type"],
            headers={"Cache-Control": "private, no-store"},
            content_disposition_type="inline",
        )

    @app.get("/api/admin/users/{user_id}/voice-notes/{filename}")
    def get_admin_user_voice_note(
        user_id: UUID,
        filename: str,
        admin: Dict[str, Any] = Depends(require_admin),
    ) -> Response:
        if not re.fullmatch(r"[a-f0-9]{32}\.(webm|ogg|mp4)", filename):
            raise ApiError(404, "voice_note_not_found", "That voice note could not be found.")
        audio_url = "/api/media/voice-notes/{}".format(filename)
        with database.connection() as connection:
            message = connection.execute(
                """SELECT id
                   FROM direct_messages
                   WHERE audio_url = %s
                     AND (sender_id = %s OR recipient_id = %s)
                   LIMIT 1""",
                (audio_url, user_id, user_id),
            ).fetchone()
            if not message:
                raise ApiError(404, "voice_note_not_found", "That voice note could not be found.")
            connection.execute(
                """INSERT INTO admin_audit_log (admin_user_id, subject_user_id, action, details)
                   VALUES (%s, %s, 'view_user_voice_note', %s::jsonb)""",
                (admin["id"], user_id, json.dumps({"type": "voice_note"})),
            )
        audio_path = uploads_directory / "voice-notes" / filename
        if not audio_path.is_file():
            raise ApiError(404, "voice_note_not_found", "That voice note could not be found.")
        media_type = {"webm": "audio/webm", "ogg": "audio/ogg", "mp4": "audio/mp4"}[filename.rsplit(".", 1)[1]]
        return FileResponse(
            audio_path,
            media_type=media_type,
            headers={"Cache-Control": "private, no-store"},
        )

    @app.get("/api/admin/audit-log")
    def get_admin_audit_log(
        limit: int = Query(default=100, ge=1, le=200),
        _admin: Dict[str, Any] = Depends(require_admin),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT log.id, log.action, log.details, log.created_at,
                          admin.id AS admin_id, admin.display_name AS admin_name,
                          admin.email AS admin_email,
                          subject.id AS subject_id, subject.display_name AS subject_name,
                          subject.email AS subject_email
                   FROM admin_audit_log log
                   JOIN users admin ON admin.id = log.admin_user_id
                   LEFT JOIN users subject ON subject.id = log.subject_user_id
                   ORDER BY log.created_at DESC, log.id DESC
                   LIMIT %s""",
                (limit,),
            ).fetchall()
        return {
            "events": [
                {
                    "id": str(row["id"]),
                    "action": row["action"],
                    "details": row["details"] or {},
                    "createdAt": row["created_at"].isoformat(),
                    "admin": {"id": str(row["admin_id"]), "name": row["admin_name"], "email": row["admin_email"]},
                    "subject": None if row["subject_id"] is None else {
                        "id": str(row["subject_id"]),
                        "name": row["subject_name"],
                        "email": row["subject_email"],
                    },
                }
                for row in rows
            ],
        }

    @app.get("/api/statuses")
    def list_user_statuses(
        request: Request,
        user_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            connection.execute(
                "DELETE FROM user_statuses WHERE expires_at <= now()"
            )
            rows = connection.execute(
                """SELECT status.id, status.user_id, status.image_url, status.caption,
                          status.created_at, status.expires_at,
                          author.display_name, author.username,
                          author.profile_image_url,
                          EXISTS (
                              SELECT 1 FROM user_status_views mine
                              WHERE mine.status_id = status.id
                                AND mine.viewer_id = %s
                          ) AS viewed_by_me,
                          status.user_id = %s AS is_mine,
                          (SELECT count(*) FROM user_status_views views
                           WHERE views.status_id = status.id) AS view_count
                   FROM user_statuses status
                   JOIN users author ON author.id = status.user_id
                   WHERE status.expires_at > now()
                     AND (%s::uuid IS NULL OR status.user_id = %s)
                     AND (
                         status.user_id = %s
                         OR EXISTS (
                             SELECT 1 FROM user_follows followed
                             WHERE followed.follower_id = %s
                               AND followed.following_id = status.user_id
                         )
                         OR EXISTS (
                             SELECT 1 FROM direct_conversations conversation
                             WHERE (conversation.participant_one_id = %s
                                    AND conversation.participant_two_id = status.user_id)
                                OR (conversation.participant_two_id = %s
                                    AND conversation.participant_one_id = status.user_id)
                         )
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM user_blocks blocked
                         WHERE (blocked.blocker_id = %s AND blocked.blocked_id = status.user_id)
                            OR (blocked.blocker_id = status.user_id AND blocked.blocked_id = %s)
                     )
                   ORDER BY status.created_at DESC
                   LIMIT 200""",
                (
                    user["id"],
                    user["id"],
                    user_id,
                    user_id,
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                ),
            ).fetchall()
        return {"statuses": [public_status(row) for row in rows]}

    @app.post(
        "/api/statuses",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_user_status(
        input: UserStatusInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO user_statuses (user_id, image_url, caption)
                   VALUES (%s, %s, %s)
                   RETURNING id""",
                (user["id"], input.image_url, input.caption),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "Your status could not be posted.")
            row = connection.execute(
                """SELECT status.id, status.user_id, status.image_url, status.caption,
                          status.created_at, status.expires_at,
                          author.display_name, author.username,
                          author.profile_image_url,
                          false AS viewed_by_me,
                          true AS is_mine,
                          0 AS view_count
                   FROM user_statuses status
                   JOIN users author ON author.id = status.user_id
                   WHERE status.id = %s AND status.user_id = %s""",
                (inserted["id"], user["id"]),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "Your status could not be loaded.")
        return {"status": public_status(row)}

    @app.get("/api/statuses/{status_id}")
    def get_user_status(
        status_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            row = connection.execute(
                """SELECT status.id, status.user_id, status.image_url, status.caption,
                          status.created_at, status.expires_at,
                          author.display_name, author.username,
                          author.profile_image_url,
                          EXISTS (
                              SELECT 1 FROM user_status_views mine
                              WHERE mine.status_id = status.id
                                AND mine.viewer_id = %s
                          ) AS viewed_by_me,
                          status.user_id = %s AS is_mine,
                          (SELECT count(*) FROM user_status_views views
                           WHERE views.status_id = status.id) AS view_count
                   FROM user_statuses status
                   JOIN users author ON author.id = status.user_id
                   WHERE status.id = %s
                     AND status.expires_at > now()
                     AND (
                         status.user_id = %s
                         OR EXISTS (
                             SELECT 1 FROM user_follows followed
                             WHERE followed.follower_id = %s
                               AND followed.following_id = status.user_id
                         )
                         OR EXISTS (
                             SELECT 1 FROM direct_conversations conversation
                             WHERE (conversation.participant_one_id = %s
                                    AND conversation.participant_two_id = status.user_id)
                                OR (conversation.participant_two_id = %s
                                    AND conversation.participant_one_id = status.user_id)
                         )
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM user_blocks blocked
                         WHERE (blocked.blocker_id = %s AND blocked.blocked_id = status.user_id)
                            OR (blocked.blocker_id = status.user_id AND blocked.blocked_id = %s)
                     )""",
                (
                    user["id"],
                    user["id"],
                    status_id,
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                ),
            ).fetchone()
            if not row:
                raise ApiError(404, "status_not_found", "That status is unavailable or has expired.")
            is_mine = bool(row["is_mine"])
            if not is_mine:
                if not row["viewed_by_me"]:
                    inserted_view = connection.execute(
                        """INSERT INTO user_status_views (status_id, viewer_id)
                           VALUES (%s, %s)
                           ON CONFLICT (status_id, viewer_id) DO NOTHING
                           RETURNING status_id""",
                        (status_id, user["id"]),
                    ).fetchone()
                    if inserted_view:
                        row["view_count"] = int(row["view_count"]) + 1
                row["viewed_by_me"] = True
            if is_mine:
                viewers = connection.execute(
                    """SELECT viewer.id, viewer.display_name, viewer.username,
                              viewer.profile_image_url, status_view.viewed_at
                       FROM user_status_views status_view
                       JOIN users viewer ON viewer.id = status_view.viewer_id
                       WHERE status_view.status_id = %s
                       ORDER BY status_view.viewed_at DESC""",
                    (status_id,),
                ).fetchall()
                row["viewers"] = [
                    {
                        "id": str(viewer["id"]),
                        "name": viewer["display_name"],
                        "username": viewer["username"],
                        "avatar": viewer.get("profile_image_url"),
                        "viewedAt": viewer["viewed_at"].isoformat(),
                    }
                    for viewer in viewers
                ]
        return {"status": public_status(row)}

    @app.delete("/api/statuses/{status_id}")
    def delete_user_status(
        status_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            deleted = connection.execute(
                """DELETE FROM user_statuses
                   WHERE id = %s AND user_id = %s
                   RETURNING id""",
                (status_id, user["id"]),
            ).fetchone()
        if not deleted:
            raise ApiError(404, "status_not_found", "That status could not be found.")
        return {"deleted": True}

    @app.get("/api/social/posts")
    def list_social_posts(
        user: Dict[str, Any] = Depends(require_user),
        following_only: bool = False,
        bookmarked_only: bool = False,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT p.id, p.body, p.image_urls, p.created_at,
                          u.id AS author_id, u.display_name, u.username,
                          u.profile_image_url AS author_image_url,
                          (SELECT count(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
                          (SELECT count(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count,
                          EXISTS (
                              SELECT 1 FROM social_post_likes mine
                              WHERE mine.post_id = p.id AND mine.user_id = %s
                          ) AS liked_by_me,
                          EXISTS (
                              SELECT 1 FROM social_post_bookmarks mine
                              WHERE mine.post_id = p.id AND mine.user_id = %s
                          ) AS bookmarked_by_me
                   FROM social_posts p
                   JOIN users u ON u.id = p.user_id
                   WHERE (
                       NOT %s
                       OR EXISTS (
                           SELECT 1 FROM user_follows followed
                           WHERE followed.follower_id = %s
                             AND followed.following_id = p.user_id
                       )
                   )
                   AND (
                       NOT %s
                       OR EXISTS (
                           SELECT 1 FROM social_post_bookmarks bookmark_filter
                           WHERE bookmark_filter.user_id = %s
                             AND bookmark_filter.post_id = p.id
                       )
                   )
                   ORDER BY p.created_at DESC
                   LIMIT %s""",
                (
                    user["id"],
                    user["id"],
                    following_only,
                    user["id"],
                    bookmarked_only,
                    user["id"],
                    limit,
                ),
            ).fetchall()
        return {"posts": [public_social_post(row, user["id"]) for row in rows]}

    @app.post(
        "/api/social/posts",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_social_post(
        input: SocialPostInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO social_posts (user_id, body, image_urls)
                   VALUES (%s, %s, %s)
                   RETURNING id""",
                (user["id"], input.text, input.image_urls),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The post could not be created.")
            post = social_post(connection, inserted["id"], user["id"])
        if not post:
            raise ApiError(500, "internal_error", "The post could not be created.")
        publish_realtime({"type": "post.created", "postId": str(post["id"])})
        return {"post": public_social_post(post, user["id"])}

    @app.put(
        "/api/social/posts/{post_id}",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def update_social_post(
        post_id: UUID,
        input: SocialPostInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE social_posts
                   SET body = %s, image_urls = %s
                   WHERE id = %s AND user_id = %s
                   RETURNING id""",
                (input.text, input.image_urls, post_id, user["id"]),
            ).fetchone()
            if not updated:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            post = social_post(connection, updated["id"], user["id"])
        if not post:
            raise ApiError(500, "internal_error", "The updated post could not be loaded.")
        publish_realtime({"type": "post.updated", "postId": str(post["id"])})
        return {"post": public_social_post(post, user["id"])}

    @app.delete(
        "/api/social/posts/{post_id}",
        status_code=204,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def delete_social_post(
        post_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Response:
        with database.connection() as connection:
            deleted = connection.execute(
                "DELETE FROM social_posts WHERE id = %s AND user_id = %s RETURNING id",
                (post_id, user["id"]),
            ).fetchone()
        if not deleted:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        publish_realtime({"type": "post.deleted", "postId": str(post_id)})
        return Response(status_code=204)

    @app.put(
        "/api/social/posts/{post_id}/bookmark",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_social_post_bookmark(
        post_id: UUID,
        input: SocialBookmarkInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, bool]:
        with database.connection() as connection:
            post = connection.execute(
                "SELECT id FROM social_posts WHERE id = %s",
                (post_id,),
            ).fetchone()
            if not post:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            if input.bookmarked:
                connection.execute(
                    """INSERT INTO social_post_bookmarks (post_id, user_id)
                       VALUES (%s, %s)
                       ON CONFLICT (post_id, user_id) DO NOTHING""",
                    (post_id, user["id"]),
                )
            else:
                connection.execute(
                    """DELETE FROM social_post_bookmarks
                       WHERE post_id = %s AND user_id = %s""",
                    (post_id, user["id"]),
                )
        publish_realtime({"type": "post.updated", "postId": str(post_id)})
        return {"bookmarked": input.bookmarked}

    @app.get("/api/social/posts/{post_id}")
    def get_social_post(
        post_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            post = social_post(connection, post_id, user["id"])
        if not post:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        return {"post": public_social_post(post, user["id"])}

    @app.put(
        "/api/social/posts/{post_id}/like",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_social_post_like(
        post_id: UUID,
        input: SocialLikeInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if not connection.execute(
                "SELECT id FROM social_posts WHERE id = %s",
                (post_id,),
            ).fetchone():
                raise ApiError(404, "post_not_found", "That post could not be found.")
            if input.liked:
                connection.execute(
                    """INSERT INTO social_post_likes (post_id, user_id)
                       VALUES (%s, %s)
                       ON CONFLICT (post_id, user_id) DO NOTHING""",
                    (post_id, user["id"]),
                )
            else:
                connection.execute(
                    "DELETE FROM social_post_likes WHERE post_id = %s AND user_id = %s",
                    (post_id, user["id"]),
                )
            post = social_post(connection, post_id, user["id"])
        if not post:
            raise ApiError(404, "post_not_found", "That post could not be found.")
        publish_realtime({"type": "post.updated", "postId": str(post_id)})
        return {"post": public_social_post(post, user["id"])}

    @app.get(
        "/api/social/posts/{post_id}/comments",
        dependencies=[Depends(require_user)],
    )
    def list_social_comments(
        post_id: UUID,
        limit: int = Query(default=100, ge=1, le=200),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if not connection.execute(
                "SELECT id FROM social_posts WHERE id = %s",
                (post_id,),
            ).fetchone():
                raise ApiError(404, "post_not_found", "That post could not be found.")
            rows = connection.execute(
                """SELECT c.id, c.body, c.created_at, c.parent_comment_id,
                          u.id AS author_id, u.display_name, u.username,
                          u.profile_image_url AS author_image_url
                   FROM social_post_comments c
                   JOIN users u ON u.id = c.user_id
                   WHERE c.post_id = %s
                   ORDER BY c.created_at ASC
                   LIMIT %s""",
                (post_id, limit),
            ).fetchall()
        return {"comments": [public_social_comment(row) for row in rows]}

    @app.post(
        "/api/social/posts/{post_id}/comments",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_social_comment(
        post_id: UUID,
        input: SocialCommentInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            if input.parent_comment_id:
                parent = connection.execute(
                    """SELECT id
                       FROM social_post_comments
                       WHERE id = %s AND post_id = %s
                         AND parent_comment_id IS NULL""",
                    (input.parent_comment_id, post_id),
                ).fetchone()
                if not parent:
                    raise ApiError(404, "comment_not_found", "That comment could not be found.")
            inserted = connection.execute(
                """INSERT INTO social_post_comments
                       (post_id, user_id, body, parent_comment_id)
                   SELECT p.id, %s, %s, %s
                   FROM social_posts p
                   WHERE p.id = %s
                   RETURNING id""",
                (user["id"], input.text, input.parent_comment_id, post_id),
            ).fetchone()
            if not inserted:
                raise ApiError(404, "post_not_found", "That post could not be found.")
            row = connection.execute(
                """SELECT c.id, c.body, c.created_at, c.parent_comment_id,
                          u.id AS author_id, u.display_name, u.username,
                          u.profile_image_url AS author_image_url
                   FROM social_post_comments c
                   JOIN users u ON u.id = c.user_id
                   WHERE c.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The reply could not be created.")
        publish_realtime({
            "type": "comment.created",
            "postId": str(post_id),
            "commentId": str(row["id"]),
        })
        return {"comment": public_social_comment(row)}

    @app.post("/api/marketplace/orders/checkout", status_code=201)
    def create_marketplace_order_checkout(
        input: MarketplaceCheckoutInput,
        request: Request,
    ) -> Dict[str, str]:
        buyer = require_user(request)
        if not settings.paystack_secret_key:
            raise ApiError(
                503,
                "payment_provider_not_configured",
                "Paystack checkout is not configured on this server yet.",
            )
        with database.connection() as connection:
            release_expired_marketplace_orders(connection)
            product = connection.execute(
                """SELECT product.id, product.name, product.price, product.stock,
                          product.published, product.seller_id, seller.display_name AS seller_name
                   FROM marketplace_products product
                   JOIN users seller ON seller.id = product.seller_id
                   WHERE product.id = %s
                   FOR UPDATE OF product""",
                (input.product_id,),
            ).fetchone()
            if not product or not product["published"]:
                raise ApiError(404, "product_not_found", "That product could not be found.")
            if str(product["seller_id"]) == str(buyer["id"]):
                raise ApiError(400, "cannot_buy_own_product", "You cannot purchase your own listing.")
            if input.quantity > int(product["stock"]):
                raise ApiError(409, "insufficient_stock", "The requested quantity is no longer available.")
            settings_row = connection.execute(
                "SELECT marketplace_commission_bps FROM posting_quota_settings WHERE id = 1"
            ).fetchone()
            if not settings_row:
                raise ApiError(503, "billing_not_configured", "Marketplace checkout is unavailable.")
            amount_minor = int(product["price"]) * 100 * input.quantity
            commission_minor = (
                amount_minor * int(settings_row["marketplace_commission_bps"]) + 5000
            ) // 10000
            updated_stock = connection.execute(
                """UPDATE marketplace_products
                   SET stock = stock - %s
                   WHERE id = %s AND stock >= %s
                   RETURNING stock""",
                (input.quantity, product["id"], input.quantity),
            ).fetchone()
            if not updated_stock:
                raise ApiError(409, "insufficient_stock", "The requested quantity is no longer available.")
            order = connection.execute(
                """INSERT INTO marketplace_orders
                       (buyer_id, seller_id, product_id, product_name, quantity,
                        unit_price_minor, amount_minor, marketplace_commission_minor,
                        seller_amount_minor, currency)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'NGN')
                   RETURNING id""",
                (
                    buyer["id"],
                    product["seller_id"],
                    product["id"],
                    product["name"],
                    input.quantity,
                    int(product["price"]) * 100,
                    amount_minor,
                    commission_minor,
                    amount_minor - commission_minor,
                ),
            ).fetchone()
            if not order:
                raise ApiError(500, "internal_error", "The marketplace order could not be created.")
            reference = "ic_order_" + uuid4().hex
            transaction = connection.execute(
                """INSERT INTO billing_transactions
                       (user_id, order_id, provider, provider_reference,
                        transaction_type, currency, amount_minor)
                   VALUES (%s, %s, 'paystack', %s, 'marketplace_order', 'NGN', %s)
                   RETURNING id""",
                (buyer["id"], order["id"], reference, amount_minor),
            ).fetchone()
            if not transaction:
                raise ApiError(500, "internal_error", "The marketplace payment could not be created.")

        try:
            result = provider_request(
                "paystack",
                settings.paystack_secret_key,
                "/transaction/initialize",
                {
                    "email": buyer["email"],
                    "amount": amount_minor,
                    "currency": "NGN",
                    "reference": reference,
                    "callback_url": settings.app_origin + "/app/orders?status=success&reference=" + reference,
                    "metadata": {
                        "transaction_id": str(transaction["id"]),
                        "order_id": str(order["id"]),
                    },
                },
            )
        except BillingProviderError as provider_error:
            logger.warning("Paystack marketplace checkout failed (HTTP %s): %s", provider_error.status_code, provider_error.detail)
            with database.connection() as connection:
                fail_marketplace_transaction(connection, transaction["id"])
            raise ApiError(
                502,
                "checkout_initialization_failed",
                "Paystack could not start checkout. Please try again.",
            ) from provider_error
        data = result.get("data") or {}
        checkout_url = data.get("authorization_url") if isinstance(data, dict) else None
        if not isinstance(checkout_url, str) or not checkout_url.startswith("https://"):
            with database.connection() as connection:
                fail_marketplace_transaction(connection, transaction["id"])
            raise ApiError(
                502,
                "checkout_initialization_failed",
                "The payment provider returned an invalid checkout link.",
            )
        return {
            "checkoutUrl": checkout_url,
            "reference": reference,
            "orderId": str(order["id"]),
        }

    @app.get("/api/marketplace/orders")
    def list_marketplace_orders(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            release_expired_marketplace_orders(connection)
            rows = connection.execute(
                """SELECT order_row.id, order_row.product_id, order_row.product_name,
                          order_row.quantity, order_row.unit_price_minor, order_row.amount_minor,
                          order_row.marketplace_commission_minor, order_row.seller_amount_minor,
                          order_row.currency, order_row.status, order_row.created_at,
                          order_row.paid_at, order_row.fulfilled_at,
                          order_row.buyer_id, buyer.display_name AS buyer_name,
                          buyer.username AS buyer_username,
                          order_row.seller_id, seller.display_name AS seller_name,
                          seller.username AS seller_username
                   FROM marketplace_orders order_row
                   JOIN users buyer ON buyer.id = order_row.buyer_id
                   JOIN users seller ON seller.id = order_row.seller_id
                   WHERE order_row.buyer_id = %s OR order_row.seller_id = %s
                   ORDER BY order_row.created_at DESC, order_row.id DESC
                   LIMIT 100""",
                (user["id"], user["id"]),
            ).fetchall()
        return {"orders": [public_marketplace_order(row, user["id"]) for row in rows]}

    @app.post("/api/marketplace/orders/{order_id}/fulfill")
    def fulfill_marketplace_order(order_id: UUID, request: Request) -> Dict[str, Any]:
        seller = require_user(request)
        with database.connection() as connection:
            order = connection.execute(
                """UPDATE marketplace_orders
                   SET status = 'fulfilled', fulfilled_at = COALESCE(fulfilled_at, now())
                   WHERE id = %s AND seller_id = %s AND status = 'paid'
                   RETURNING id""",
                (order_id, seller["id"]),
            ).fetchone()
            if not order:
                existing = connection.execute(
                    """SELECT status FROM marketplace_orders
                       WHERE id = %s AND seller_id = %s""",
                    (order_id, seller["id"]),
                ).fetchone()
                if not existing:
                    raise ApiError(404, "order_not_found", "That order could not be found.")
                if existing["status"] != "fulfilled":
                    raise ApiError(409, "order_not_ready", "Only paid orders can be marked fulfilled.")
        return {"fulfilled": True}

    @app.get("/api/marketplace/products")
    def list_marketplace_products(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        category: Optional[Literal["Style", "Tech", "Home", "Other"]] = None,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        require_user(request)
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = ["p.published"]
        parameters: List[Any] = []
        if category:
            filters.append("p.category = %s")
            parameters.append(category)
        if normalized_query:
            escaped_query = (
                normalized_query
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_query + "%"
            filters.append(
                "(lower(p.name) LIKE %s ESCAPE E'\\\\' "
                "OR lower(p.description) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.display_name) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.username) LIKE %s ESCAPE E'\\\\')"
            )
            parameters.extend([pattern] * 4)
        parameters.append(limit)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE {}
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT %s""".format(" AND ".join(filters)),
                tuple(parameters),
            ).fetchall()
        return {"products": [public_marketplace_product(row) for row in rows]}

    @app.post(
        "/api/marketplace/products",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_marketplace_product(
        input: MarketplaceProductInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO marketplace_products
                       (seller_id, name, category, price, stock, description, image_url, image_urls)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.name,
                    input.category,
                    input.price,
                    input.stock,
                    input.description,
                    input.image_url,
                    input.image_urls or ([input.image_url] if input.image_url else []),
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The product listing could not be created.")
            record_posting_usage(connection, user["id"], "products", inserted["id"])
            row = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE p.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The product listing could not be loaded.")
        return {"product": public_marketplace_product(row)}

    @app.put("/api/marketplace/products/{product_id}")
    def update_marketplace_product(
        product_id: UUID,
        input: MarketplaceProductInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        image_urls = input.image_urls or ([input.image_url] if input.image_url else [])
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE marketplace_products
                   SET name = %s, category = %s, price = %s, stock = %s,
                       description = %s, image_url = %s, image_urls = %s
                   WHERE id = %s AND seller_id = %s
                   RETURNING id""",
                (
                    input.name,
                    input.category,
                    input.price,
                    input.stock,
                    input.description,
                    input.image_url or (image_urls[0] if image_urls else None),
                    image_urls,
                    product_id,
                    user["id"],
                ),
            ).fetchone()
            if not updated:
                raise ApiError(404, "product_not_found", "That product listing could not be found.")
            row = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE p.id = %s AND p.published""",
                (product_id,),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The updated product could not be loaded.")
        return {"product": public_marketplace_product(row)}

    @app.delete("/api/marketplace/products/{product_id}")
    def delete_marketplace_product(
        product_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            order = connection.execute(
                "SELECT id FROM marketplace_orders WHERE product_id = %s LIMIT 1",
                (product_id,),
            ).fetchone()
            if order:
                raise ApiError(
                    409,
                    "product_has_orders",
                    "This product has order history and cannot be deleted. Set its available quantity to zero instead.",
                )
            deleted = connection.execute(
                """DELETE FROM marketplace_products
                   WHERE id = %s AND seller_id = %s
                   RETURNING id""",
                (product_id, user["id"]),
            ).fetchone()
        if not deleted:
            raise ApiError(404, "product_not_found", "That product listing could not be found.")
        return {"deleted": True}

    @app.get("/api/marketplace/products/{product_id}")
    def get_marketplace_product(
        product_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        require_user(request)
        with database.connection() as connection:
            row = connection.execute(
                """SELECT p.id, p.name, p.category, p.price, p.stock,
                          p.description, p.image_url, p.image_urls, p.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM marketplace_products p
                   JOIN users s ON s.id = p.seller_id
                   WHERE p.id = %s AND p.published""",
                (product_id,),
            ).fetchone()
        if not row:
            raise ApiError(404, "product_not_found", "That product could not be found.")
        return {"product": public_marketplace_product(row)}

    @app.get("/api/local-marketplace/listings")
    def list_local_marketplace_listings(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        location: Optional[str] = Query(default=None, max_length=80),
        category: Optional[Literal["Homes", "Services", "Farm"]] = None,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        require_user(request)
        normalized_query = (query or "").strip().lower()
        normalized_location = (location or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = ["l.published"]
        parameters: List[Any] = []
        if category:
            filters.append("l.category = %s")
            parameters.append(category)
        if normalized_query:
            escaped_query = (
                normalized_query
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_query + "%"
            filters.append(
                "(lower(l.title) LIKE %s ESCAPE E'\\\\' "
                "OR lower(l.description) LIKE %s ESCAPE E'\\\\' "
                "OR lower(l.detail) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.display_name) LIKE %s ESCAPE E'\\\\' "
                "OR lower(s.username) LIKE %s ESCAPE E'\\\\')"
            )
            parameters.extend([pattern] * 5)
        if normalized_location:
            escaped_location = (
                normalized_location
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            filters.append("lower(l.location) LIKE %s ESCAPE E'\\\\'")
            parameters.append("%" + escaped_location + "%")
        parameters.append(limit)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE {}
                   ORDER BY l.created_at DESC, l.id DESC
                   LIMIT %s""".format(" AND ".join(filters)),
                tuple(parameters),
            ).fetchall()
        return {"listings": [public_local_marketplace_listing(row) for row in rows]}

    @app.post(
        "/api/local-marketplace/listings",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_local_marketplace_listing(
        input: LocalMarketplaceListingInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO local_marketplace_listings
                       (seller_id, category, title, price, location, detail,
                        description, image_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.category,
                    input.title,
                    input.price,
                    input.location,
                    input.detail,
                    input.description,
                    input.image_url,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The listing could not be created.")
            record_posting_usage(connection, user["id"], "marketplace", inserted["id"])
            row = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE l.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The listing could not be loaded.")
        return {"listing": public_local_marketplace_listing(row)}

    @app.get("/api/local-marketplace/listings/{listing_id}")
    def get_local_marketplace_listing(
        listing_id: UUID,
        request: Request,
    ) -> Dict[str, Any]:
        require_user(request)
        with database.connection() as connection:
            row = connection.execute(
                """SELECT l.id, l.category, l.title, l.price, l.location,
                          l.detail, l.description, l.image_url, l.created_at,
                          s.id AS seller_id, s.display_name AS seller_name,
                          s.username AS seller_username
                   FROM local_marketplace_listings l
                   JOIN users s ON s.id = l.seller_id
                   WHERE l.id = %s AND l.published""",
                (listing_id,),
            ).fetchone()
        if not row:
            raise ApiError(404, "listing_not_found", "That listing could not be found.")
        return {"listing": public_local_marketplace_listing(row)}

    def public_ibook_stay(row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "propertyType": row["property_type"],
            "title": row["title"],
            "location": row["location"],
            "price": int(row["price"]),
            "priceUnit": row["price_unit"],
            "maxGuests": int(row["max_guests"]),
            "description": row["description"],
            "imageUrls": row["image_urls"],
            "createdAt": row["created_at"].isoformat(),
            "host": {
                "id": str(row["host_id"]),
                "name": row["host_name"],
                "username": row["host_username"],
            },
        }

    @app.get("/api/ibook/stays")
    def list_ibook_stays(
        request: Request,
        location: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        require_user(request)
        normalized_location = (location or "").strip().lower()
        if normalized_location and len(normalized_location) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = ["listing.active"]
        parameters: List[Any] = []
        if normalized_location:
            filters.append("lower(listing.location) LIKE %s")
            parameters.append("%" + normalized_location.replace("%", "\\%").replace("_", "\\_") + "%")
        parameters.append(limit)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT listing.id, listing.property_type, listing.title, listing.location,
                          listing.price, listing.price_unit, listing.max_guests, listing.description,
                          listing.image_urls, listing.created_at, listing.host_id,
                          host.display_name AS host_name, host.username AS host_username
                   FROM ibook_stay_listings listing
                   JOIN users host ON host.id = listing.host_id
                   WHERE {} ORDER BY listing.created_at DESC, listing.id DESC LIMIT %s""".format(
                    " AND ".join(filters)
                ),
                tuple(parameters),
            ).fetchall()
        return {"stays": [public_ibook_stay(row) for row in rows]}

    @app.post("/api/ibook/stays", status_code=201, dependencies=[Depends(enforce_social_rate_limit)])
    def create_ibook_stay(
        input: IBookStayInput,
        request: Request,
    ) -> Dict[str, Any]:
        host = require_user(request)
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO ibook_stay_listings
                       (host_id, property_type, title, location, price, price_unit,
                        max_guests, description, image_urls)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    host["id"], input.property_type, input.title, input.location,
                    input.price, input.price_unit, input.max_guests, input.description,
                    input.image_urls,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The stay listing could not be created.")
            row = connection.execute(
                """SELECT listing.id, listing.property_type, listing.title, listing.location,
                          listing.price, listing.price_unit, listing.max_guests, listing.description,
                          listing.image_urls, listing.created_at, listing.host_id,
                          host.display_name AS host_name, host.username AS host_username
                   FROM ibook_stay_listings listing JOIN users host ON host.id = listing.host_id
                   WHERE listing.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The stay listing could not be loaded.")
        return {"stay": public_ibook_stay(row)}

    @app.post("/api/ibook/stay-bookings", status_code=201, dependencies=[Depends(enforce_social_rate_limit)])
    def request_ibook_stay_booking(
        input: IBookStayBookingInput,
        request: Request,
    ) -> Dict[str, Any]:
        guest = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                """SELECT id, host_id, max_guests FROM ibook_stay_listings
                   WHERE id = %s AND active FOR UPDATE""",
                (input.listing_id,),
            ).fetchone()
            if not listing:
                raise ApiError(404, "stay_not_found", "That stay is no longer available.")
            if str(listing["host_id"]) == str(guest["id"]):
                raise ApiError(400, "cannot_book_own_stay", "You cannot request your own property.")
            if input.guests > int(listing["max_guests"]):
                raise ApiError(400, "guest_limit_exceeded", "This property cannot accommodate that many guests.")
            overlap = connection.execute(
                """SELECT id FROM ibook_stay_bookings
                   WHERE listing_id = %s AND status = 'confirmed'
                     AND check_in < %s AND check_out > %s LIMIT 1""",
                (input.listing_id, input.check_out, input.check_in),
            ).fetchone()
            if overlap:
                raise ApiError(409, "stay_dates_unavailable", "Those dates have already been confirmed.")
            booking = connection.execute(
                """INSERT INTO ibook_stay_bookings
                       (listing_id, guest_id, check_in, check_out, guests, message)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (
                    input.listing_id, guest["id"], input.check_in, input.check_out,
                    input.guests, input.message.strip(),
                ),
            ).fetchone()
        if not booking:
            raise ApiError(500, "internal_error", "Your stay request could not be saved.")
        return {"bookingId": str(booking["id"]), "status": "requested"}

    @app.get("/api/ibook/stay-bookings")
    def list_ibook_stay_bookings(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT booking.id, booking.listing_id, listing.title,
                          booking.guest_id, guest.display_name AS guest_name,
                          guest.username AS guest_username, listing.host_id,
                          host.display_name AS host_name, host.username AS host_username,
                          booking.check_in, booking.check_out, booking.guests,
                          booking.message, booking.status, booking.created_at
                   FROM ibook_stay_bookings booking
                   JOIN ibook_stay_listings listing ON listing.id = booking.listing_id
                   JOIN users guest ON guest.id = booking.guest_id
                   JOIN users host ON host.id = listing.host_id
                   WHERE booking.guest_id = %s OR listing.host_id = %s
                   ORDER BY booking.created_at DESC LIMIT 100""",
                (user["id"], user["id"]),
            ).fetchall()
        return {"bookings": [{
            "id": str(row["id"]),
            "listingId": str(row["listing_id"]),
            "title": row["title"],
            "checkIn": row["check_in"].isoformat(),
            "checkOut": row["check_out"].isoformat(),
            "guests": int(row["guests"]),
            "message": row["message"],
            "status": row["status"],
            "createdAt": row["created_at"].isoformat(),
            "role": "guest" if str(row["guest_id"]) == str(user["id"]) else "host",
            "otherParty": {
                "id": str(row["host_id"] if str(row["guest_id"]) == str(user["id"]) else row["guest_id"]),
                "name": row["host_name"] if str(row["guest_id"]) == str(user["id"]) else row["guest_name"],
                "username": row["host_username"] if str(row["guest_id"]) == str(user["id"]) else row["guest_username"],
            },
        } for row in rows]}

    @app.post("/api/ibook/stay-bookings/{booking_id}/status")
    def update_ibook_stay_booking(
        booking_id: UUID,
        input: IBookStatusInput,
        request: Request,
    ) -> Dict[str, str]:
        user = require_user(request)
        if input.status not in {"confirmed", "declined", "cancelled"}:
            raise ApiError(400, "invalid_booking_status", "That update is not valid for a stay request.")
        with database.connection() as connection:
            booking = connection.execute(
                """SELECT booking.listing_id, booking.guest_id, booking.status, listing.host_id
                   FROM ibook_stay_bookings booking
                   JOIN ibook_stay_listings listing ON listing.id = booking.listing_id
                   WHERE booking.id = %s""",
                (booking_id,),
            ).fetchone()
            if not booking:
                raise ApiError(404, "booking_not_found", "That stay request could not be found.")
            is_guest = str(booking["guest_id"]) == str(user["id"])
            is_host = str(booking["host_id"]) == str(user["id"])
            if (input.status == "cancelled" and not is_guest) or (
                input.status in {"confirmed", "declined"} and not is_host
            ):
                raise ApiError(403, "not_allowed", "You cannot update this stay request.")
            allowed_current_statuses = (
                {"requested", "confirmed"} if input.status == "cancelled" else {"requested"}
            )
            if booking["status"] not in allowed_current_statuses:
                raise ApiError(409, "booking_already_updated", "This stay request has already been updated.")
            if input.status == "confirmed":
                connection.execute(
                    "SELECT id FROM ibook_stay_listings WHERE id = %s FOR UPDATE",
                    (booking["listing_id"],),
                ).fetchone()
                overlap = connection.execute(
                    """SELECT id FROM ibook_stay_bookings
                       WHERE listing_id = %s AND id <> %s AND status = 'confirmed'
                         AND check_in < (SELECT check_out FROM ibook_stay_bookings WHERE id = %s)
                         AND check_out > (SELECT check_in FROM ibook_stay_bookings WHERE id = %s)
                       LIMIT 1""",
                    (booking["listing_id"], booking_id, booking_id, booking_id),
                ).fetchone()
                if overlap:
                    raise ApiError(409, "stay_dates_unavailable", "Those dates conflict with another confirmed stay.")
            updated = connection.execute(
                """UPDATE ibook_stay_bookings SET status = %s
                   WHERE id = %s AND status = ANY(%s) RETURNING id""",
                (input.status, booking_id, list(allowed_current_statuses)),
            ).fetchone()
            if not updated:
                raise ApiError(409, "booking_already_updated", "This stay request has already been updated.")
        return {"status": input.status}

    @app.get("/api/ibook/drivers")
    def list_ibook_drivers(
        request: Request,
        area: Optional[str] = Query(default=None, max_length=80),
        passengers: int = Query(default=1, ge=1, le=8),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_area = (area or "").strip().lower()
        if normalized_area and len(normalized_area) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = ["profile.available", "profile.seats >= %s", "profile.driver_id <> %s"]
        parameters: List[Any] = [passengers, user["id"]]
        if normalized_area:
            filters.append("lower(profile.service_area) LIKE %s")
            parameters.append("%" + normalized_area.replace("%", "\\%").replace("_", "\\_") + "%")
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT profile.driver_id, profile.vehicle_type, profile.vehicle_description,
                          profile.service_area, profile.seats, profile.updated_at,
                          driver.display_name, driver.username
                   FROM ibook_driver_profiles profile
                   JOIN users driver ON driver.id = profile.driver_id
                   WHERE {} ORDER BY profile.updated_at DESC LIMIT 100""".format(" AND ".join(filters)),
                tuple(parameters),
            ).fetchall()
        return {"drivers": [{
            "id": str(row["driver_id"]),
            "name": row["display_name"],
            "username": row["username"],
            "vehicleType": row["vehicle_type"],
            "vehicleDescription": row["vehicle_description"],
            "serviceArea": row["service_area"],
            "seats": int(row["seats"]),
        } for row in rows]}

    @app.put("/api/ibook/drivers/me")
    def update_ibook_driver_profile(input: IBookDriverInput, request: Request) -> Dict[str, Any]:
        driver = require_user(request)
        with database.connection() as connection:
            connection.execute(
                "SELECT driver_id FROM ibook_driver_profiles WHERE driver_id = %s FOR UPDATE",
                (driver["id"],),
            ).fetchone()
            if input.available:
                active_ride = connection.execute(
                    """SELECT id FROM ibook_ride_requests
                       WHERE driver_id = %s AND status = 'accepted' LIMIT 1""",
                    (driver["id"],),
                ).fetchone()
                if active_ride:
                    raise ApiError(409, "driver_on_active_ride", "Finish your current ride before going available.")
            row = connection.execute(
                """INSERT INTO ibook_driver_profiles
                       (driver_id, vehicle_type, vehicle_description, service_area, seats, available)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (driver_id) DO UPDATE SET
                       vehicle_type = EXCLUDED.vehicle_type,
                       vehicle_description = EXCLUDED.vehicle_description,
                       service_area = EXCLUDED.service_area,
                       seats = EXCLUDED.seats,
                       available = EXCLUDED.available,
                       updated_at = now()
                   RETURNING driver_id, vehicle_type, vehicle_description, service_area, seats, available""",
                (
                    driver["id"], input.vehicle_type, input.vehicle_description,
                    input.service_area, input.seats, input.available,
                ),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "Your driver profile could not be saved.")
        return {"driver": {
            "id": str(row["driver_id"]),
            "vehicleType": row["vehicle_type"],
            "vehicleDescription": row["vehicle_description"],
            "serviceArea": row["service_area"],
            "seats": int(row["seats"]),
            "available": bool(row["available"]),
        }}

    @app.get("/api/ibook/drivers/me")
    def get_ibook_driver_profile(request: Request) -> Dict[str, Any]:
        driver = require_user(request)
        with database.connection() as connection:
            row = connection.execute(
                """SELECT driver_id, vehicle_type, vehicle_description, service_area,
                          seats, available
                   FROM ibook_driver_profiles WHERE driver_id = %s""",
                (driver["id"],),
            ).fetchone()
        if not row:
            return {"driver": None}
        return {"driver": {
            "id": str(row["driver_id"]),
            "vehicleType": row["vehicle_type"],
            "vehicleDescription": row["vehicle_description"],
            "serviceArea": row["service_area"],
            "seats": int(row["seats"]),
            "available": bool(row["available"]),
        }}

    @app.get("/api/ibook/rides")
    def list_ibook_rides(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT ride.id, ride.rider_id, rider.display_name AS rider_name,
                          rider.username AS rider_username, ride.driver_id,
                          driver.display_name AS driver_name, driver.username AS driver_username,
                          ride.pickup, ride.destination, ride.pickup_time, ride.passengers,
                          ride.note, ride.status, ride.created_at
                   FROM ibook_ride_requests ride
                   JOIN users rider ON rider.id = ride.rider_id
                   JOIN users driver ON driver.id = ride.driver_id
                   WHERE ride.rider_id = %s OR ride.driver_id = %s
                   ORDER BY ride.created_at DESC LIMIT 100""",
                (user["id"], user["id"]),
            ).fetchall()
        return {"rides": [{
            "id": str(row["id"]),
            "pickup": row["pickup"],
            "destination": row["destination"],
            "pickupTime": row["pickup_time"].isoformat(),
            "passengers": int(row["passengers"]),
            "note": row["note"],
            "status": row["status"],
            "createdAt": row["created_at"].isoformat(),
            "role": "rider" if str(row["rider_id"]) == str(user["id"]) else "driver",
            "otherParty": {
                "id": str(row["driver_id"] if str(row["rider_id"]) == str(user["id"]) else row["rider_id"]),
                "name": row["driver_name"] if str(row["rider_id"]) == str(user["id"]) else row["rider_name"],
                "username": row["driver_username"] if str(row["rider_id"]) == str(user["id"]) else row["rider_username"],
            },
        } for row in rows]}

    @app.post("/api/ibook/rides", status_code=201, dependencies=[Depends(enforce_social_rate_limit)])
    def request_ibook_ride(input: IBookRideInput, request: Request) -> Dict[str, str]:
        rider = require_user(request)
        with database.connection() as connection:
            driver = connection.execute(
                """SELECT driver_id, seats FROM ibook_driver_profiles
                   WHERE driver_id = %s AND available FOR UPDATE""",
                (input.driver_id,),
            ).fetchone()
            if not driver:
                raise ApiError(409, "driver_unavailable", "That driver is no longer available.")
            if str(driver["driver_id"]) == str(rider["id"]):
                raise ApiError(400, "cannot_ride_with_self", "You cannot request yourself as a driver.")
            if input.passengers > int(driver["seats"]):
                raise ApiError(400, "passenger_limit_exceeded", "That vehicle does not have enough seats.")
            ride = connection.execute(
                """INSERT INTO ibook_ride_requests
                       (rider_id, driver_id, pickup, destination, pickup_time, passengers, note)
                   VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (
                    rider["id"], driver["driver_id"], input.pickup, input.destination,
                    input.pickup_time, input.passengers, input.note.strip(),
                ),
            ).fetchone()
        if not ride:
            raise ApiError(500, "internal_error", "Your ride request could not be saved.")
        return {"rideId": str(ride["id"]), "status": "requested"}

    @app.post("/api/ibook/rides/{ride_id}/status")
    def update_ibook_ride_status(
        ride_id: UUID,
        input: IBookStatusInput,
        request: Request,
    ) -> Dict[str, str]:
        user = require_user(request)
        if input.status not in {"accepted", "declined", "cancelled", "completed"}:
            raise ApiError(400, "invalid_ride_status", "That update is not valid for a ride request.")
        with database.connection() as connection:
            ride = connection.execute(
                """SELECT rider_id, driver_id, status FROM ibook_ride_requests WHERE id = %s FOR UPDATE""",
                (ride_id,),
            ).fetchone()
            if not ride:
                raise ApiError(404, "ride_not_found", "That ride request could not be found.")
            is_rider = str(ride["rider_id"]) == str(user["id"])
            is_driver = str(ride["driver_id"]) == str(user["id"])
            if (input.status == "cancelled" and not is_rider) or (
                input.status in {"accepted", "declined", "completed"} and not is_driver
            ):
                raise ApiError(403, "not_allowed", "You cannot update this ride request.")
            allowed = (
                {"requested"} if input.status in {"accepted", "declined", "cancelled"}
                else {"accepted"}
            )
            if ride["status"] not in allowed:
                raise ApiError(409, "ride_already_updated", "This ride request cannot be updated in its current state.")
            if input.status == "accepted":
                available_driver = connection.execute(
                    """SELECT driver_id FROM ibook_driver_profiles
                       WHERE driver_id = %s AND available FOR UPDATE""",
                    (user["id"],),
                ).fetchone()
                if not available_driver:
                    raise ApiError(409, "driver_unavailable", "You must be available before accepting a ride.")
                active_ride = connection.execute(
                    """SELECT id FROM ibook_ride_requests
                       WHERE driver_id = %s AND status = 'accepted' AND id <> %s LIMIT 1""",
                    (user["id"], ride_id),
                ).fetchone()
                if active_ride:
                    raise ApiError(409, "driver_busy", "Complete the current ride before accepting another.")
                connection.execute(
                    "UPDATE ibook_driver_profiles SET available = false, updated_at = now() WHERE driver_id = %s",
                    (user["id"],),
                )
            connection.execute(
                """UPDATE ibook_ride_requests SET status = %s, updated_at = now()
                   WHERE id = %s""",
                (input.status, ride_id),
            )
        return {"status": input.status}

    @app.get("/api/messages/users")
    def search_message_recipients(
        request: Request,
        query: str = Query(min_length=2, max_length=40),
        limit: int = Query(default=20, ge=1, le=50),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = query.strip().lstrip("@").lower()
        if len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = escaped_query + "%"
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT id, display_name, username, profile_image_url
                   FROM users
                   WHERE email_verified_at IS NOT NULL
                     AND profile_visible AND discoverable
                     AND id <> %s
                     AND (
                         lower(username) LIKE %s ESCAPE E'\\\\'
                         OR lower(display_name) LIKE %s ESCAPE E'\\\\'
                     )
                   ORDER BY lower(username), lower(display_name)
                   LIMIT %s""",
                (user["id"], pattern, pattern, limit),
            ).fetchall()
        return {
            "users": [
                {
                    "id": str(row["id"]),
                    "name": row["display_name"],
                    "username": row["username"],
                    "avatar": row.get("profile_image_url"),
                }
                for row in rows
            ],
        }

    @app.get("/api/communities")
    def list_communities(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = "%" + escaped_query + "%" if escaped_query else None
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT c.id, c.owner_id, c.name, c.description, c.image_url,
                          c.rules, c.members_can_post, c.membership_mode, c.created_at,
                          owner.display_name AS owner_name,
                          owner.username AS owner_username,
                          (SELECT count(*) FROM community_memberships members
                           WHERE members.community_id = c.id) AS member_count,
                          (SELECT count(*) FROM community_join_requests requests
                           WHERE requests.community_id = c.id AND requests.status = 'pending')
                            AS pending_request_count,
                          EXISTS (
                              SELECT 1 FROM community_memberships mine
                              WHERE mine.community_id = c.id AND mine.user_id = %s
                          ) AS joined_by_me,
                          EXISTS (
                              SELECT 1 FROM community_join_requests mine_request
                              WHERE mine_request.community_id = c.id
                                AND mine_request.user_id = %s
                                AND mine_request.status = 'pending'
                          ) AS join_requested_by_me,
                          c.owner_id = %s AS is_admin
                   FROM communities c
                   JOIN users owner ON owner.id = c.owner_id
                   WHERE %s::text IS NULL
                      OR lower(c.name) LIKE %s ESCAPE E'\\\\'
                      OR lower(c.description) LIKE %s ESCAPE E'\\\\'
                   ORDER BY c.created_at DESC, c.id DESC
                   LIMIT %s""",
                (user["id"], user["id"], user["id"], pattern, pattern, pattern, limit),
            ).fetchall()
        return {"communities": [public_community(row) for row in rows]}

    @app.post(
        "/api/communities",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_community(
        input: CommunityInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            inserted = connection.execute(
                """INSERT INTO communities
                       (owner_id, name, description, image_url, rules, members_can_post,
                        membership_mode)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.name,
                    input.description,
                    input.image_url,
                    input.rules,
                    input.members_can_post,
                    input.membership_mode,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The community could not be created.")
            connection.execute(
                """INSERT INTO community_memberships (community_id, user_id)
                   VALUES (%s, %s)
                   ON CONFLICT (community_id, user_id) DO NOTHING""",
                (inserted["id"], user["id"]),
            )
            row = community_record(connection, inserted["id"], user["id"])
        if not row:
            raise ApiError(500, "internal_error", "The community could not be loaded.")
        return {"community": public_community(row)}

    @app.get("/api/communities/{community_id}")
    def get_community(
        community_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            row = community_record(connection, community_id, user["id"])
        if not row:
            raise ApiError(404, "community_not_found", "That community could not be found.")
        return {"community": public_community(row)}

    @app.put(
        "/api/communities/{community_id}",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def update_community(
        community_id: UUID,
        input: CommunityInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            updated = connection.execute(
                """UPDATE communities
                   SET name = %s, description = %s, image_url = %s,
                       rules = %s, members_can_post = %s, membership_mode = %s
                   WHERE id = %s AND owner_id = %s
                   RETURNING id""",
                (
                    input.name,
                    input.description,
                    input.image_url,
                    input.rules,
                    input.members_can_post,
                    input.membership_mode,
                    community_id,
                    user["id"],
                ),
            ).fetchone()
            if not updated:
                exists = connection.execute(
                    "SELECT id FROM communities WHERE id = %s",
                    (community_id,),
                ).fetchone()
                if not exists:
                    raise ApiError(404, "community_not_found", "That community could not be found.")
                raise ApiError(403, "community_admin_required", "Only the community creator can change its settings.")
            row = community_record(connection, community_id, user["id"])
        if not row:
            raise ApiError(500, "internal_error", "The community settings could not be loaded.")
        return {"community": public_community(row)}

    @app.put(
        "/api/communities/{community_id}/membership",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_community_membership(
        community_id: UUID,
        input: CommunityMembershipInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            community = connection.execute(
                "SELECT id, owner_id, membership_mode FROM communities WHERE id = %s",
                (community_id,),
            ).fetchone()
            if not community:
                raise ApiError(404, "community_not_found", "That community could not be found.")
            if input.joined:
                if (
                    community["membership_mode"] == "approval"
                    and str(community["owner_id"]) != str(user["id"])
                ):
                    already_member = connection.execute(
                        """SELECT user_id FROM community_memberships
                           WHERE community_id = %s AND user_id = %s""",
                        (community_id, user["id"]),
                    ).fetchone()
                    if not already_member:
                        connection.execute(
                            """INSERT INTO community_join_requests (community_id, user_id, status)
                               VALUES (%s, %s, 'pending')
                               ON CONFLICT (community_id, user_id)
                               DO UPDATE SET status = 'pending', updated_at = now()""",
                            (community_id, user["id"]),
                        )
                else:
                    connection.execute(
                        """INSERT INTO community_memberships (community_id, user_id)
                           VALUES (%s, %s)
                           ON CONFLICT (community_id, user_id) DO NOTHING""",
                        (community_id, user["id"]),
                    )
                    connection.execute(
                        """UPDATE community_join_requests
                           SET status = 'approved', updated_at = now()
                           WHERE community_id = %s AND user_id = %s
                             AND status = 'pending'""",
                        (community_id, user["id"]),
                    )
            else:
                if str(community["owner_id"]) == str(user["id"]):
                    raise ApiError(409, "community_owner_cannot_leave", "The community creator must remain a member.")
                connection.execute(
                    """DELETE FROM community_memberships
                       WHERE community_id = %s AND user_id = %s""",
                    (community_id, user["id"]),
                )
                connection.execute(
                    """UPDATE community_join_requests
                       SET status = 'cancelled', updated_at = now()
                       WHERE community_id = %s AND user_id = %s AND status = 'pending'""",
                    (community_id, user["id"]),
                )
            row = community_record(connection, community_id, user["id"])
        if not row:
            raise ApiError(404, "community_not_found", "That community could not be found.")
        return {"community": public_community(row)}

    @app.get("/api/communities/{community_id}/members")
    def list_community_members(
        community_id: UUID,
        limit: int = Query(default=100, ge=1, le=200),
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            community = require_community_member(connection, community_id, user["id"])
            rows = connection.execute(
                """SELECT member.id, member.display_name, member.username,
                          member.profile_image_url, membership.created_at
                   FROM community_memberships membership
                   JOIN users member ON member.id = membership.user_id
                   WHERE membership.community_id = %s
                   ORDER BY (member.id = %s) DESC, membership.created_at ASC
                   LIMIT %s""",
                (community_id, community["owner_id"], limit),
            ).fetchall()
        return {
            "members": [
                {
                    "id": str(row["id"]),
                    "name": row["display_name"],
                    "username": row["username"],
                    "image": row.get("profile_image_url"),
                    "isOwner": str(row["id"]) == str(community["owner_id"]),
                }
                for row in rows
            ],
        }

    @app.delete(
        "/api/communities/{community_id}/members/{member_id}",
        status_code=204,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def remove_community_member(
        community_id: UUID,
        member_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Response:
        with database.connection() as connection:
            community = connection.execute(
                "SELECT owner_id FROM communities WHERE id = %s",
                (community_id,),
            ).fetchone()
            if not community:
                raise ApiError(404, "community_not_found", "That community could not be found.")
            if str(community["owner_id"]) != str(user["id"]):
                raise ApiError(403, "community_admin_required", "Only the community creator can remove members.")
            if str(community["owner_id"]) == str(member_id):
                raise ApiError(409, "cannot_remove_community_owner", "The community creator cannot be removed.")
            removed = connection.execute(
                """DELETE FROM community_memberships
                   WHERE community_id = %s AND user_id = %s
                   RETURNING user_id""",
                (community_id, member_id),
            ).fetchone()
            if not removed:
                raise ApiError(404, "community_member_not_found", "That community member could not be found.")
        return Response(status_code=204)

    @app.get("/api/communities/{community_id}/join-requests")
    def list_community_join_requests(
        community_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            community = connection.execute(
                "SELECT owner_id FROM communities WHERE id = %s",
                (community_id,),
            ).fetchone()
            if not community:
                raise ApiError(404, "community_not_found", "That community could not be found.")
            if str(community["owner_id"]) != str(user["id"]):
                raise ApiError(403, "community_admin_required", "Only the community creator can review join requests.")
            rows = connection.execute(
                """SELECT requester.id, requester.display_name, requester.username,
                          requester.profile_image_url, request.created_at
                   FROM community_join_requests request
                   JOIN users requester ON requester.id = request.user_id
                   WHERE request.community_id = %s AND request.status = 'pending'
                   ORDER BY request.created_at, requester.id
                   LIMIT 100""",
                (community_id,),
            ).fetchall()
        return {
            "requests": [
                {
                    "id": str(row["id"]),
                    "name": row["display_name"],
                    "username": row["username"],
                    "image": row.get("profile_image_url"),
                    "requestedAt": row["created_at"].isoformat(),
                }
                for row in rows
            ],
        }

    @app.put(
        "/api/communities/{community_id}/join-requests/{member_id}",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def review_community_join_request(
        community_id: UUID,
        member_id: UUID,
        input: CommunityJoinRequestInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, bool]:
        with database.connection() as connection:
            community = connection.execute(
                "SELECT owner_id FROM communities WHERE id = %s",
                (community_id,),
            ).fetchone()
            if not community:
                raise ApiError(404, "community_not_found", "That community could not be found.")
            if str(community["owner_id"]) != str(user["id"]):
                raise ApiError(403, "community_admin_required", "Only the community creator can review join requests.")
            request_row = connection.execute(
                """SELECT user_id FROM community_join_requests
                   WHERE community_id = %s AND user_id = %s AND status = 'pending'""",
                (community_id, member_id),
            ).fetchone()
            if not request_row:
                raise ApiError(404, "community_join_request_not_found", "That join request could not be found.")
            if input.approved:
                connection.execute(
                    """INSERT INTO community_memberships (community_id, user_id)
                       VALUES (%s, %s)
                       ON CONFLICT (community_id, user_id) DO NOTHING""",
                    (community_id, member_id),
                )
            connection.execute(
                """UPDATE community_join_requests
                   SET status = %s, updated_at = now()
                   WHERE community_id = %s AND user_id = %s AND status = 'pending'""",
                ("approved" if input.approved else "declined", community_id, member_id),
            )
        return {"approved": input.approved}

    @app.get("/api/communities/{community_id}/posts")
    def list_community_posts(
        community_id: UUID,
        limit: int = Query(default=50, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            community = require_community_member(connection, community_id, user["id"])
            rows = connection.execute(
                """SELECT post.id, post.body, post.image_urls, post.created_at,
                          author.id AS author_id, author.display_name, author.username,
                          author.profile_image_url AS author_image_url
                   FROM community_posts post
                   JOIN users author ON author.id = post.user_id
                   WHERE post.community_id = %s
                   ORDER BY post.created_at DESC, post.id DESC
                   LIMIT %s OFFSET %s""",
                (community_id, limit, offset),
            ).fetchall()
            owner_id = community["owner_id"]
        return {
            "posts": [
                public_community_post(row, user["id"], owner_id)
                for row in rows
            ],
            "page": {"limit": limit, "offset": offset},
        }

    @app.post(
        "/api/communities/{community_id}/posts",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_community_post(
        community_id: UUID,
        input: SocialPostInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            community = require_community_member(connection, community_id, user["id"])
            if not community["members_can_post"] and str(community["owner_id"]) != str(user["id"]):
                raise ApiError(403, "community_posting_restricted", "Only the community creator can post here.")
            inserted = connection.execute(
                """INSERT INTO community_posts (community_id, user_id, body, image_urls)
                   VALUES (%s, %s, %s, %s)
                   RETURNING id""",
                (community_id, user["id"], input.text, input.image_urls),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The community post could not be created.")
            row = connection.execute(
                """SELECT post.id, post.body, post.image_urls, post.created_at,
                          author.id AS author_id, author.display_name, author.username,
                          author.profile_image_url AS author_image_url
                   FROM community_posts post
                   JOIN users author ON author.id = post.user_id
                   WHERE post.id = %s""",
                (inserted["id"],),
            ).fetchone()
            owner_id = community["owner_id"]
        if not row:
            raise ApiError(500, "internal_error", "The community post could not be loaded.")
        return {"post": public_community_post(row, user["id"], owner_id)}

    @app.delete(
        "/api/communities/{community_id}/posts/{post_id}",
        status_code=204,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def delete_community_post(
        community_id: UUID,
        post_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Response:
        with database.connection() as connection:
            deleted = connection.execute(
                """DELETE FROM community_posts post
                   USING communities community
                   WHERE post.id = %s
                     AND post.community_id = %s
                     AND community.id = post.community_id
                     AND (post.user_id = %s OR community.owner_id = %s)
                   RETURNING post.id""",
                (post_id, community_id, user["id"], user["id"]),
            ).fetchone()
        if not deleted:
            raise ApiError(404, "community_post_not_found", "That community post could not be found.")
        return Response(status_code=204)

    @app.get("/api/people")
    def discover_people(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=40),
        following_only: bool = False,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lstrip("@").lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        escaped_query = (
            normalized_query
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = escaped_query + "%" if escaped_query else None
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT person.id, person.display_name, person.username, person.bio,
                          person.interests, person.profile_image_url,
                          (SELECT count(*)
                           FROM user_follows followers
                           WHERE followers.following_id = person.id) AS follower_count,
                          (SELECT count(*)
                           FROM user_follows following
                           WHERE following.follower_id = person.id) AS following_count,
                          EXISTS (
                              SELECT 1
                              FROM user_follows mine
                              WHERE mine.follower_id = %s
                                AND mine.following_id = person.id
                          ) AS followed_by_me
                   FROM users person
                   WHERE person.email_verified_at IS NOT NULL
                     AND person.profile_visible
                     AND person.discoverable
                     AND person.id <> %s
                     AND (
                         %s::text IS NULL
                         OR lower(person.username) LIKE %s ESCAPE E'\\\\'
                         OR lower(person.display_name) LIKE %s ESCAPE E'\\\\'
                         OR EXISTS (
                             SELECT 1
                             FROM unnest(person.interests) AS interest(value)
                             WHERE lower(interest.value) LIKE %s ESCAPE E'\\\\'
                         )
                     )
                     AND (
                         NOT %s
                         OR EXISTS (
                             SELECT 1
                             FROM user_follows following_filter
                             WHERE following_filter.follower_id = %s
                               AND following_filter.following_id = person.id
                         )
                     )
                   ORDER BY lower(person.display_name), lower(person.username)
                   LIMIT %s""",
                (
                    user["id"],
                    user["id"],
                    pattern,
                    pattern,
                    pattern,
                    pattern,
                    following_only,
                    user["id"],
                    limit,
                ),
            ).fetchall()
        return {"people": [public_discoverable_user(row) for row in rows]}

    @app.put(
        "/api/people/{person_id}/follow",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_person_follow(
        person_id: UUID,
        input: UserFollowInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        if str(person_id) == str(user["id"]):
            raise ApiError(400, "invalid_follow", "You cannot follow your own account.")
        with database.connection() as connection:
            person = connection.execute(
                """SELECT id
                   FROM users
                   WHERE id = %s AND email_verified_at IS NOT NULL
                     AND profile_visible AND discoverable""",
                (person_id,),
            ).fetchone()
            if not person:
                raise ApiError(404, "person_not_found", "That account could not be found.")
            if input.following:
                connection.execute(
                    """INSERT INTO user_follows (follower_id, following_id)
                       VALUES (%s, %s)
                       ON CONFLICT (follower_id, following_id) DO NOTHING""",
                    (user["id"], person_id),
                )
            else:
                connection.execute(
                    """DELETE FROM user_follows
                       WHERE follower_id = %s AND following_id = %s""",
                    (user["id"], person_id),
                )
            counts = connection.execute(
                """SELECT
                       (SELECT count(*) FROM user_follows
                        WHERE following_id = %s) AS follower_count,
                       (SELECT count(*) FROM user_follows
                        WHERE follower_id = %s) AS following_count""",
                (person_id, person_id),
            ).fetchone()
        if not counts:
            raise ApiError(500, "internal_error", "The follow status could not be updated.")
        return {
            "following": input.following,
            "followerCount": int(counts["follower_count"]),
            "followingCount": int(counts["following_count"]),
        }

    def job_record(connection: Any, job_id: UUID, viewer_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT j.id, j.title, j.company, j.company_image_url, j.location, j.employment_type,
                      j.workplace_type, j.summary, j.description, j.created_at,
                      author.display_name, author.username,
                      EXISTS (
                          SELECT 1 FROM job_bookmarks bookmark
                          WHERE bookmark.job_id = j.id AND bookmark.user_id = %s
                      ) AS is_saved,
                      EXISTS (
                          SELECT 1 FROM job_applications mine
                          WHERE mine.job_id = j.id AND mine.applicant_id = %s
                      ) AS applied_by_me,
                      j.user_id = %s AS is_owner,
                      (SELECT count(*) FROM job_applications applications
                       WHERE applications.job_id = j.id) AS application_count,
                      (SELECT mine.status FROM job_applications mine
                       WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_status,
                      (SELECT mine.cover_letter FROM job_applications mine
                       WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_cover_letter
               FROM job_listings j
               JOIN users author ON author.id = j.user_id
               WHERE j.id = %s""",
            (viewer_id, viewer_id, viewer_id, viewer_id, viewer_id, job_id),
        ).fetchone()

    @app.get("/api/jobs")
    def list_jobs(
        request: Request,
        query: Optional[str] = Query(default=None, max_length=80),
        location: Optional[str] = Query(default=None, max_length=80),
        workplace_type: Optional[Literal["remote", "hybrid", "onsite"]] = None,
        view: Literal["all", "saved", "applied", "mine"] = "all",
        limit: int = Query(default=50, ge=1, le=100),
    ) -> Dict[str, Any]:
        user = require_user(request)
        normalized_query = (query or "").strip().lower()
        normalized_location = (location or "").strip().lower()
        if normalized_query and len(normalized_query) < 2:
            raise ApiError(400, "invalid_input", "Enter at least two characters to search.")
        filters = []
        parameters: List[Any] = [user["id"], user["id"], user["id"], user["id"], user["id"]]
        if view == "saved":
            filters.append(
                "EXISTS (SELECT 1 FROM job_bookmarks filter_bookmark "
                "WHERE filter_bookmark.job_id = j.id AND filter_bookmark.user_id = %s)"
            )
            parameters.append(user["id"])
        elif view == "applied":
            filters.append(
                "EXISTS (SELECT 1 FROM job_applications filter_application "
                "WHERE filter_application.job_id = j.id AND filter_application.applicant_id = %s)"
            )
            parameters.append(user["id"])
        elif view == "mine":
            filters.append("j.user_id = %s")
            parameters.append(user["id"])

        if normalized_query:
            escaped_query = (
                normalized_query
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_query + "%"
            filters.append(
                "(lower(j.title) LIKE %s ESCAPE E'\\\\' "
                "OR lower(j.company) LIKE %s ESCAPE E'\\\\' "
                "OR lower(j.summary) LIKE %s ESCAPE E'\\\\' "
                "OR lower(j.description) LIKE %s ESCAPE E'\\\\')"
            )
            parameters.extend([pattern] * 4)
        if normalized_location:
            escaped_location = (
                normalized_location
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            pattern = "%" + escaped_location + "%"
            filters.append("lower(j.location) LIKE %s ESCAPE E'\\\\'")
            parameters.append(pattern)
        if workplace_type:
            filters.append("j.workplace_type = %s")
            parameters.append(workplace_type)
        parameters.append(limit)

        with database.connection() as connection:
            rows = connection.execute(
                """SELECT j.id, j.title, j.company, j.company_image_url, j.location, j.employment_type,
                          j.workplace_type, j.summary, j.description, j.created_at,
                          author.display_name, author.username,
                          EXISTS (
                              SELECT 1 FROM job_bookmarks bookmark
                              WHERE bookmark.job_id = j.id AND bookmark.user_id = %s
                          ) AS is_saved,
                          EXISTS (
                              SELECT 1 FROM job_applications mine
                              WHERE mine.job_id = j.id AND mine.applicant_id = %s
                          ) AS applied_by_me,
                          j.user_id = %s AS is_owner,
                          (SELECT count(*) FROM job_applications applications
                           WHERE applications.job_id = j.id) AS application_count,
                          (SELECT mine.status FROM job_applications mine
                           WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_status,
                          (SELECT mine.cover_letter FROM job_applications mine
                           WHERE mine.job_id = j.id AND mine.applicant_id = %s) AS application_cover_letter
                   FROM job_listings j
                   JOIN users author ON author.id = j.user_id
                   WHERE {}
                   ORDER BY j.created_at DESC, j.id DESC
                   LIMIT %s""".format(" AND ".join(filters) if filters else "TRUE"),
                tuple(parameters),
            ).fetchall()
        jobs = [public_job(row) for row in rows]
        external = {"jobs": [], "warnings": [], "enabled": False}
        if view == "all":
            external = fetch_external_jobs(
                settings.greenhouse_board_tokens,
                settings.smartrecruiters_company_ids,
                query=query or "",
                location=location or "",
                workplace_type=workplace_type or "",
                limit=limit,
            )
            jobs.extend(external["jobs"])

            def published_timestamp(job: Dict[str, Any]) -> float:
                try:
                    published_at = datetime.fromisoformat(
                        str(job["createdAt"]).replace("Z", "+00:00")
                    )
                    if published_at.tzinfo is None:
                        published_at = published_at.replace(tzinfo=timezone.utc)
                    return published_at.timestamp()
                except (KeyError, TypeError, ValueError):
                    return 0.0

            jobs.sort(key=published_timestamp, reverse=True)
            jobs = jobs[:limit]
        return {
            "jobs": jobs,
            "externalJobsEnabled": external["enabled"],
            "externalSourceWarnings": external["warnings"],
        }

    @app.get("/api/jobs/business-profile")
    def get_job_business_profile(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            profile = connection.execute(
                "SELECT * FROM job_business_profiles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
        document_url = "/api/jobs/business-profile/document" if profile else None
        return {
            "businessProfile": public_job_business_profile(profile, document_url),
        }

    @app.post("/api/jobs/business-profile", status_code=201)
    async def submit_job_business_profile(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        enforce_media_upload_rate_limit(request)
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        supported_signatures = {
            "application/pdf": lambda value: value.startswith(b"%PDF-"),
            "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
            "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/webp": lambda value: (
                len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP"
            ),
        }
        signature_matches = supported_signatures.get(content_type)
        if not signature_matches:
            raise ApiError(400, "invalid_business_document", "Upload a CAC document as PDF, JPEG, PNG, or WebP.")
        try:
            profile_payload = json.loads(unquote(request.headers.get("x-company-details", ""), errors="strict"))
            profile_input = JobBusinessProfileInput(**profile_payload)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValidationError) as error:
            raise ApiError(400, "invalid_business_profile", "Complete all company details and try again.") from error

        filename = uuid4().hex + {
            "application/pdf": ".pdf",
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }[content_type]
        temporary_path = business_documents_directory / (filename + ".uploading")
        document_path = business_documents_directory / filename
        total_size = 0
        signature = bytearray()
        old_filename = None
        try:
            await asyncio.to_thread(business_documents_directory.mkdir, parents=True, exist_ok=True)
            with temporary_path.open("xb") as output:
                async for chunk in request.stream():
                    if not chunk:
                        continue
                    total_size += len(chunk)
                    if total_size > MAX_BUSINESS_DOCUMENT_BYTES:
                        raise ApiError(413, "business_document_too_large", "CAC documents must be 10 MB or smaller.")
                    if len(signature) < 16:
                        signature.extend(chunk[:16 - len(signature)])
                    output.write(chunk)
            if not total_size or not signature_matches(bytes(signature)):
                raise ApiError(400, "invalid_business_document", "The uploaded file does not match its document format.")
            await asyncio.to_thread(temporary_path.replace, document_path)
            with database.connection() as connection:
                existing = connection.execute(
                    "SELECT document_filename FROM job_business_profiles WHERE user_id = %s",
                    (user["id"],),
                ).fetchone()
                old_filename = existing["document_filename"] if existing else None
                profile = connection.execute(
                    """INSERT INTO job_business_profiles
                           (user_id, company_name, registration_number, business_type,
                            business_address, contact_phone, description, document_filename,
                            document_content_type, document_size)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (user_id) DO UPDATE SET
                           company_name = EXCLUDED.company_name,
                           registration_number = EXCLUDED.registration_number,
                           business_type = EXCLUDED.business_type,
                           business_address = EXCLUDED.business_address,
                           contact_phone = EXCLUDED.contact_phone,
                           description = EXCLUDED.description,
                           document_filename = EXCLUDED.document_filename,
                           document_content_type = EXCLUDED.document_content_type,
                           document_size = EXCLUDED.document_size,
                           updated_at = now()
                       RETURNING *""",
                    (
                        user["id"],
                        profile_input.company_name,
                        profile_input.registration_number,
                        profile_input.business_type,
                        profile_input.business_address,
                        profile_input.contact_phone,
                        profile_input.description,
                        filename,
                        content_type,
                        total_size,
                    ),
                ).fetchone()
        except ApiError:
            temporary_path.unlink(missing_ok=True)
            document_path.unlink(missing_ok=True)
            raise
        except OSError as error:
            temporary_path.unlink(missing_ok=True)
            document_path.unlink(missing_ok=True)
            logger.exception("Could not save a CAC document for user %s", user["id"])
            raise ApiError(500, "media_unavailable", "The CAC document could not be saved. Check server media storage.") from error
        except Exception:
            temporary_path.unlink(missing_ok=True)
            document_path.unlink(missing_ok=True)
            raise
        if not profile:
            document_path.unlink(missing_ok=True)
            raise ApiError(500, "internal_error", "The company profile could not be saved.")
        if old_filename and old_filename != filename:
            try:
                (business_documents_directory / old_filename).unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not remove the replaced CAC document for user %s", user["id"])
        return {
            "businessProfile": public_job_business_profile(
                profile,
                "/api/jobs/business-profile/document",
            ),
        }

    @app.get("/api/jobs/business-profile/document")
    def get_own_business_document(request: Request) -> Response:
        user = require_user(request)
        with database.connection() as connection:
            profile = connection.execute(
                """SELECT document_filename, document_content_type
                   FROM job_business_profiles WHERE user_id = %s""",
                (user["id"],),
            ).fetchone()
        if not profile:
            raise ApiError(404, "business_document_not_found", "No CAC document was submitted.")
        document_path = business_documents_directory / profile["document_filename"]
        if not document_path.is_file():
            raise ApiError(404, "business_document_not_found", "The submitted CAC document is no longer available.")
        return FileResponse(
            document_path,
            media_type=profile["document_content_type"],
            headers={"Cache-Control": "private, no-store"},
            content_disposition_type="inline",
        )

    @app.post(
        "/api/jobs",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_job(
        input: JobListingInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            business_profile = connection.execute(
                "SELECT user_id FROM job_business_profiles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
            if not business_profile:
                raise ApiError(
                    403,
                    "business_profile_required",
                    "Submit your company details and CAC document before posting a job.",
                )
            inserted = connection.execute(
                """INSERT INTO job_listings
                       (user_id, title, company, location, employment_type,
                        workplace_type, summary, description, company_image_url)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id""",
                (
                    user["id"],
                    input.title,
                    input.company,
                    input.location,
                    input.employment_type,
                    input.workplace_type,
                    input.summary,
                    input.description,
                    input.company_image_url,
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(500, "internal_error", "The job listing could not be created.")
            record_posting_usage(connection, user["id"], "jobs", inserted["id"])
            row = job_record(connection, inserted["id"], user["id"])
        if not row:
            raise ApiError(500, "internal_error", "The job listing could not be created.")
        return {"job": public_job(row)}

    @app.put(
        "/api/jobs/{job_id}/save",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_job_saved(
        job_id: UUID,
        input: JobSaveInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                "SELECT id FROM job_listings WHERE id = %s",
                (job_id,),
            ).fetchone()
            if not listing:
                raise ApiError(404, "job_not_found", "That job listing could not be found.")
            if input.saved:
                connection.execute(
                    """INSERT INTO job_bookmarks (user_id, job_id)
                       VALUES (%s, %s)
                       ON CONFLICT (user_id, job_id) DO NOTHING""",
                    (user["id"], job_id),
                )
            else:
                connection.execute(
                    "DELETE FROM job_bookmarks WHERE user_id = %s AND job_id = %s",
                    (user["id"], job_id),
                )
        return {"saved": input.saved}

    @app.post(
        "/api/jobs/{job_id}/applications",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def apply_to_job(
        job_id: UUID,
        input: JobApplicationInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                "SELECT id, user_id FROM job_listings WHERE id = %s",
                (job_id,),
            ).fetchone()
            if not listing:
                raise ApiError(404, "job_not_found", "That job listing could not be found.")
            if str(listing["user_id"]) == str(user["id"]):
                raise ApiError(400, "invalid_application", "You cannot apply to your own job listing.")
            inserted = connection.execute(
                """INSERT INTO job_applications (job_id, applicant_id, cover_letter)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (job_id, applicant_id) DO NOTHING
                   RETURNING id""",
                (job_id, user["id"], input.cover_letter),
            ).fetchone()
            application = connection.execute(
                """SELECT id, job_id, cover_letter, status, created_at
                   FROM job_applications
                   WHERE job_id = %s AND applicant_id = %s""",
                (job_id, user["id"]),
            ).fetchone()
        if not application:
            raise ApiError(500, "internal_error", "Your application could not be saved.")
        return {
            "application": {
                "id": str(application["id"]),
                "jobId": str(application["job_id"]),
                "coverLetter": application["cover_letter"],
                "status": application["status"],
                "createdAt": application["created_at"].isoformat(),
            },
            "alreadyApplied": inserted is None,
        }

    @app.get("/api/jobs/{job_id}/applications")
    def list_job_applications(
        job_id: UUID,
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            listing = connection.execute(
                "SELECT id, user_id FROM job_listings WHERE id = %s",
                (job_id,),
            ).fetchone()
            if not listing or str(listing["user_id"]) != str(user["id"]):
                raise ApiError(404, "job_not_found", "That job listing could not be found.")
            rows = connection.execute(
                """SELECT application.id, application.cover_letter, application.status,
                          application.created_at, applicant.display_name, applicant.username
                   FROM job_applications application
                   JOIN users applicant ON applicant.id = application.applicant_id
                   WHERE application.job_id = %s
                   ORDER BY application.created_at DESC
                   LIMIT %s""",
                (job_id, limit),
            ).fetchall()
        return {
            "applications": [
                {
                    "id": str(row["id"]),
                    "coverLetter": row["cover_letter"],
                    "status": row["status"],
                    "createdAt": row["created_at"].isoformat(),
                    "applicant": {
                        "name": row["display_name"],
                        "username": row["username"],
                    },
                }
                for row in rows
            ],
        }

    @app.get("/api/messages/conversations")
    def list_direct_conversations(request: Request) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT c.id, c.created_at,
                          other.id AS recipient_id,
                          other.display_name AS recipient_name,
                          other.username AS recipient_username,
                          other.profile_image_url AS recipient_avatar,
                          EXISTS (
                              SELECT 1 FROM user_statuses active_status
                              WHERE active_status.user_id = other.id
                                AND active_status.expires_at > now()
                          ) AS has_active_status,
                          latest.body AS last_message,
                          latest.image_url AS last_image_url,
                          latest.created_at AS last_message_at,
                          EXISTS (
                              SELECT 1
                              FROM user_blocks block
                              WHERE block.blocker_id = %s
                                AND block.blocked_id = other.id
                          ) AS is_blocked_by_me,
                          EXISTS (
                              SELECT 1
                              FROM user_blocks block
                              WHERE block.blocker_id = other.id
                                AND block.blocked_id = %s
                          ) AS is_blocked_by_them,
                          COALESCE(preferences.is_muted, false) AS is_muted,
                          COALESCE(preferences.is_archived, false) AS is_archived,
                          (SELECT count(*)
                           FROM direct_messages unread
                           WHERE unread.conversation_id = c.id
                             AND unread.recipient_id = %s
                             AND unread.read_at IS NULL) AS unread_count
                   FROM direct_conversations c
                   JOIN users other
                     ON other.id = CASE
                         WHEN c.participant_one_id = %s THEN c.participant_two_id
                         ELSE c.participant_one_id
                     END
                   LEFT JOIN LATERAL (
                       SELECT body, image_url, created_at
                       FROM direct_messages
                       WHERE conversation_id = c.id
                       ORDER BY created_at DESC, id DESC
                       LIMIT 1
                   ) latest ON TRUE
                   LEFT JOIN direct_conversation_preferences preferences
                     ON preferences.conversation_id = c.id
                    AND preferences.user_id = %s
                   WHERE c.participant_one_id = %s OR c.participant_two_id = %s
                   ORDER BY COALESCE(latest.created_at, c.created_at) DESC""",
                (
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                    user["id"],
                ),
            ).fetchall()
        return {
            "conversations": [
                {
                    "id": str(row["id"]),
                    "recipient": {
                        "id": str(row["recipient_id"]),
                        "name": row["recipient_name"],
                        "username": row["recipient_username"],
                        "avatar": row.get("recipient_avatar"),
                        "hasActiveStatus": bool(row.get("has_active_status")),
                    },
                    "lastMessage": row["last_message"] or ("Photo" if row.get("last_image_url") else ""),
                    "lastMessageAt": (
                        row["last_message_at"] or row["created_at"]
                    ).isoformat(),
                    "unreadCount": int(row["unread_count"]),
                    "isBlockedByMe": bool(row["is_blocked_by_me"]),
                    "isBlockedByThem": bool(row["is_blocked_by_them"]),
                    "isMuted": bool(row["is_muted"]),
                    "isArchived": bool(row["is_archived"]),
                }
                for row in rows
            ],
        }

    @app.post(
        "/api/messages/conversations",
        status_code=201,
        dependencies=[Depends(enforce_message_rate_limit)],
    )
    def create_direct_conversation(
        input: DirectConversationInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        if str(input.recipient_id) == str(user["id"]):
            raise ApiError(400, "invalid_recipient", "You cannot start a conversation with yourself.")
        with database.connection() as connection:
            recipient = connection.execute(
                """SELECT id
                   FROM users
                   WHERE id = %s AND email_verified_at IS NOT NULL
                     AND profile_visible AND discoverable""",
                (input.recipient_id,),
            ).fetchone()
            if not recipient:
                raise ApiError(404, "user_not_found", "That account could not be found.")
            block = connection.execute(
                """SELECT EXISTS (
                       SELECT 1 FROM user_blocks
                       WHERE blocker_id = %s AND blocked_id = %s
                   ) AS blocked_by_me,
                   EXISTS (
                       SELECT 1 FROM user_blocks
                       WHERE blocker_id = %s AND blocked_id = %s
                   ) AS blocked_by_them""",
                (user["id"], input.recipient_id, input.recipient_id, user["id"]),
            ).fetchone()
            if block and block["blocked_by_me"]:
                raise ApiError(403, "blocked_by_me", "You blocked this person. Unblock them to send a message.")
            if block and block["blocked_by_them"]:
                raise ApiError(403, "blocked_by_them", "You can’t message this person because they blocked you.")
            conversation = connection.execute(
                """INSERT INTO direct_conversations (participant_one_id, participant_two_id)
                   VALUES (LEAST(%s, %s), GREATEST(%s, %s))
                   ON CONFLICT (participant_one_id, participant_two_id)
                   DO UPDATE SET created_at = direct_conversations.created_at
                   RETURNING id""",
                (user["id"], input.recipient_id, user["id"], input.recipient_id),
            ).fetchone()
        if not conversation:
            raise ApiError(500, "internal_error", "The conversation could not be opened.")
        return {"conversationId": str(conversation["id"])}

    @app.put("/api/messages/conversations/{conversation_id}/block")
    def update_direct_conversation_block(
        conversation_id: UUID,
        input: DirectConversationBlockInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            conversation = connection.execute(
                """SELECT other.id AS recipient_id
                   FROM direct_conversations c
                   JOIN users other
                     ON other.id = CASE
                         WHEN c.participant_one_id = %s THEN c.participant_two_id
                         ELSE c.participant_one_id
                     END
                   WHERE c.id = %s
                     AND (c.participant_one_id = %s OR c.participant_two_id = %s)""",
                (user["id"], conversation_id, user["id"], user["id"]),
            ).fetchone()
            if not conversation:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            if input.blocked:
                connection.execute(
                    """INSERT INTO user_blocks (blocker_id, blocked_id)
                       VALUES (%s, %s)
                       ON CONFLICT (blocker_id, blocked_id) DO NOTHING""",
                    (user["id"], conversation["recipient_id"]),
                )
            else:
                connection.execute(
                    "DELETE FROM user_blocks WHERE blocker_id = %s AND blocked_id = %s",
                    (user["id"], conversation["recipient_id"]),
                )
        return {"isBlockedByMe": input.blocked}

    @app.put("/api/messages/conversations/{conversation_id}/preferences")
    def update_direct_conversation_preferences(
        conversation_id: UUID,
        input: DirectConversationPreferencesInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            conversation = connection.execute(
                """SELECT id
                   FROM direct_conversations
                   WHERE id = %s
                     AND (participant_one_id = %s OR participant_two_id = %s)""",
                (conversation_id, user["id"], user["id"]),
            ).fetchone()
            if not conversation:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            preferences = connection.execute(
                """INSERT INTO direct_conversation_preferences
                       (conversation_id, user_id, is_muted, is_archived)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (conversation_id, user_id)
                   DO UPDATE SET is_muted = EXCLUDED.is_muted,
                                 is_archived = EXCLUDED.is_archived,
                                 updated_at = now()
                   RETURNING is_muted, is_archived""",
                (conversation_id, user["id"], input.is_muted, input.is_archived),
            ).fetchone()
        if not preferences:
            raise ApiError(500, "internal_error", "Chat settings could not be saved.")
        return {
            "isMuted": bool(preferences["is_muted"]),
            "isArchived": bool(preferences["is_archived"]),
        }

    @app.get("/api/messages/conversations/{conversation_id}/messages")
    def list_direct_messages(
        conversation_id: UUID,
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
        query: Optional[str] = Query(default=None, min_length=1, max_length=200),
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            conversation = connection.execute(
                """SELECT id
                   FROM direct_conversations
                   WHERE id = %s
                     AND (participant_one_id = %s OR participant_two_id = %s)""",
                (conversation_id, user["id"], user["id"]),
            ).fetchone()
            if not conversation:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            if query:
                read_messages = []
                rows = connection.execute(
                    """SELECT message.id, message.body, message.image_url, message.audio_url,
                              message.edited_at, message.created_at, message.read_at,
                              message.sender_id,
                              sender.display_name, sender.username
                       FROM (
                           SELECT id, body, image_url, audio_url, edited_at, created_at, read_at, sender_id
                           FROM direct_messages
                           WHERE conversation_id = %s
                             AND strpos(lower(body), lower(%s)) > 0
                           ORDER BY created_at DESC, id DESC
                           LIMIT %s
                       ) message
                       JOIN users sender ON sender.id = message.sender_id
                       ORDER BY message.created_at ASC, message.id ASC""",
                    (conversation_id, query.strip(), limit),
                ).fetchall()
            else:
                read_messages = connection.execute(
                    """UPDATE direct_messages
                       SET read_at = now()
                       WHERE conversation_id = %s
                         AND recipient_id = %s
                         AND read_at IS NULL
                       RETURNING sender_id""",
                    (conversation_id, user["id"]),
                ).fetchall()
                rows = connection.execute(
                    """SELECT message.id, message.body, message.image_url, message.audio_url,
                              message.edited_at, message.created_at, message.read_at,
                              message.sender_id,
                              sender.display_name, sender.username
                       FROM (
                           SELECT id, body, image_url, audio_url, edited_at, created_at, read_at, sender_id
                           FROM direct_messages
                           WHERE conversation_id = %s
                           ORDER BY created_at DESC, id DESC
                           LIMIT %s
                       ) message
                       JOIN users sender ON sender.id = message.sender_id
                       ORDER BY message.created_at ASC, message.id ASC""",
                    (conversation_id, limit),
                ).fetchall()
        sender_ids = list({row["sender_id"] for row in read_messages})
        if sender_ids:
            publish_realtime(
                {"type": "message.read", "conversationId": str(conversation_id)},
                sender_ids,
            )
        return {
            "messages": [
                public_direct_message(row, user["id"])
                for row in rows
            ],
        }

    @app.post(
        "/api/messages/conversations/{conversation_id}/messages",
        status_code=201,
        dependencies=[Depends(enforce_message_rate_limit)],
    )
    def create_direct_message(
        conversation_id: UUID,
        input: DirectMessageInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            block = connection.execute(
                """SELECT other.id AS recipient_id,
                          EXISTS (
                              SELECT 1 FROM user_blocks
                              WHERE blocker_id = %s AND blocked_id = other.id
                          ) AS blocked_by_me,
                          EXISTS (
                              SELECT 1 FROM user_blocks
                              WHERE blocker_id = other.id AND blocked_id = %s
                          ) AS blocked_by_them
                   FROM direct_conversations c
                   JOIN users other
                     ON other.id = CASE
                         WHEN c.participant_one_id = %s THEN c.participant_two_id
                         ELSE c.participant_one_id
                     END
                   WHERE c.id = %s
                     AND (c.participant_one_id = %s OR c.participant_two_id = %s)""",
                (user["id"], user["id"], user["id"], conversation_id, user["id"], user["id"]),
            ).fetchone()
            if block and block["blocked_by_me"]:
                raise ApiError(403, "blocked_by_me", "You blocked this person. Unblock them to send a message.")
            if block and block["blocked_by_them"]:
                raise ApiError(403, "blocked_by_them", "You can’t message this person because they blocked you.")
            inserted = connection.execute(
                """INSERT INTO direct_messages
                       (conversation_id, sender_id, recipient_id, body, image_url, audio_url)
                   SELECT c.id, %s,
                          CASE
                              WHEN c.participant_one_id = %s THEN c.participant_two_id
                              ELSE c.participant_one_id
                          END,
                          COALESCE(%s, CASE WHEN %s::text IS NOT NULL THEN 'Voice note' ELSE 'Photo' END),
                          %s, %s
                   FROM direct_conversations c
                   WHERE c.id = %s
                     AND (c.participant_one_id = %s OR c.participant_two_id = %s)
                   RETURNING id""",
                (
                    user["id"],
                    user["id"],
                    input.text,
                    input.audio_url,
                    input.image_url,
                    input.audio_url,
                    conversation_id,
                    user["id"],
                    user["id"],
                ),
            ).fetchone()
            if not inserted:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            row = connection.execute(
                """SELECT message.id, message.body, message.image_url, message.audio_url,
                          message.edited_at, message.created_at, message.read_at,
                          message.sender_id, message.recipient_id,
                          sender.display_name, sender.username
                   FROM direct_messages message
                   JOIN users sender ON sender.id = message.sender_id
                   WHERE message.id = %s""",
                (inserted["id"],),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The message could not be sent.")
        publish_realtime(
            {
                "type": "message.created",
                "conversationId": str(conversation_id),
                "messageId": str(row["id"]),
                "senderId": str(row["sender_id"]),
            },
            [row["recipient_id"]],
        )
        return {"message": public_direct_message(row, user["id"])}

    @app.put(
        "/api/messages/conversations/{conversation_id}/messages/{message_id}",
        dependencies=[Depends(enforce_message_rate_limit)],
    )
    def edit_direct_message(
        conversation_id: UUID,
        message_id: UUID,
        input: DirectMessageEditInput,
        request: Request,
    ) -> Dict[str, Any]:
        user = require_user(request)
        with database.connection() as connection:
            existing = connection.execute(
                """SELECT id, sender_id, image_url, audio_url, created_at
                   FROM direct_messages
                   WHERE id = %s AND conversation_id = %s""",
                (message_id, conversation_id),
            ).fetchone()
            if not existing or str(existing["sender_id"]) != str(user["id"]):
                raise ApiError(404, "message_not_found", "That message could not be found.")
            if existing["image_url"] or existing.get("audio_url"):
                raise ApiError(400, "message_not_editable", "Only text messages can be edited.")
            block = connection.execute(
                """SELECT other.id AS recipient_id,
                          EXISTS (
                              SELECT 1 FROM user_blocks
                              WHERE blocker_id = %s AND blocked_id = other.id
                          ) AS blocked_by_me,
                          EXISTS (
                              SELECT 1 FROM user_blocks
                              WHERE blocker_id = other.id AND blocked_id = %s
                          ) AS blocked_by_them
                   FROM direct_conversations conversation
                   JOIN users other ON other.id = CASE
                       WHEN conversation.participant_one_id = %s THEN conversation.participant_two_id
                       ELSE conversation.participant_one_id
                   END
                   WHERE conversation.id = %s
                     AND (conversation.participant_one_id = %s OR conversation.participant_two_id = %s)""",
                (user["id"], user["id"], user["id"], conversation_id, user["id"], user["id"]),
            ).fetchone()
            if not block:
                raise ApiError(404, "conversation_not_found", "That conversation could not be found.")
            if block["blocked_by_me"] or block["blocked_by_them"]:
                raise ApiError(403, "message_edit_blocked", "Messages cannot be edited in a blocked conversation.")
            row = connection.execute(
                """UPDATE direct_messages
                   SET body = %s, edited_at = now()
                   WHERE id = %s AND conversation_id = %s AND sender_id = %s
                   RETURNING id""",
                (input.text, message_id, conversation_id, user["id"]),
            ).fetchone()
            if not row:
                raise ApiError(404, "message_not_found", "That message could not be found.")
            updated = connection.execute(
                """SELECT message.id, message.body, message.image_url, message.audio_url,
                          message.edited_at, message.created_at, message.read_at,
                          message.sender_id, message.recipient_id,
                          sender.display_name, sender.username
                   FROM direct_messages message
                   JOIN users sender ON sender.id = message.sender_id
                   WHERE message.id = %s""",
                (message_id,),
            ).fetchone()
        if not updated:
            raise ApiError(500, "internal_error", "The edited message could not be loaded.")
        publish_realtime(
            {
                "type": "message.updated",
                "conversationId": str(conversation_id),
                "messageId": str(message_id),
                "senderId": str(updated["sender_id"]),
            },
            [block["recipient_id"]],
        )
        return {"message": public_direct_message(updated, user["id"])}

    def public_dating_profile(row: Dict[str, Any]) -> Dict[str, Any]:
        today = date.today()
        birth_date = row["birth_date"]
        age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
        return {
            "user_id": row["user_id"],
            "name": row["display_name"],
            "username": row["username"],
            "age": age,
            "gender": row["gender"],
            "seeking": row["seeking"],
            "location": row["location"],
            "bio": row["bio"],
            "interests": row["interests"],
            "image_urls": row["image_urls"],
            "active": row["active"],
        }

    def get_dating_profile(connection: Any, user_id: Any) -> Optional[Dict[str, Any]]:
        return connection.execute(
            """SELECT profile.user_id, profile.birth_date, profile.gender, profile.seeking,
                      profile.location, profile.bio, profile.interests, profile.image_urls,
                      profile.active, account.display_name, account.username
               FROM dating_profiles profile
               JOIN users account ON account.id = profile.user_id
               WHERE profile.user_id = %s""",
            (user_id,),
        ).fetchone()

    def require_active_dating_profile(connection: Any, user_id: Any) -> Dict[str, Any]:
        row = get_dating_profile(connection, user_id)
        if not row:
            raise ApiError(403, "dating_profile_required", "Create your dating profile before using this feature.")
        if not row["active"]:
            raise ApiError(403, "dating_profile_paused", "Activate your dating profile to use dating.")
        today = date.today()
        age = today.year - row["birth_date"].year - (
            (today.month, today.day) < (row["birth_date"].month, row["birth_date"].day)
        )
        if age < 18:
            raise ApiError(403, "adult_only", "Dating is available only to adults aged 18 or older.")
        return row

    def require_dating_match(connection: Any, match_id: UUID, user_id: Any) -> Dict[str, Any]:
        match = connection.execute(
            """SELECT id, participant_one_id, participant_two_id
               FROM dating_matches
               WHERE id = %s AND (participant_one_id = %s OR participant_two_id = %s)""",
            (match_id, user_id, user_id),
        ).fetchone()
        if not match:
            raise ApiError(404, "dating_match_not_found", "That dating match could not be found.")
        other_id = (
            match["participant_two_id"]
            if str(match["participant_one_id"]) == str(user_id)
            else match["participant_one_id"]
        )
        blocked = connection.execute(
            """SELECT 1 FROM dating_blocks
               WHERE (blocker_id = %s AND blocked_id = %s)
                  OR (blocker_id = %s AND blocked_id = %s)
               LIMIT 1""",
            (user_id, other_id, other_id, user_id),
        ).fetchone()
        if blocked:
            raise ApiError(403, "dating_match_unavailable", "This dating conversation is no longer available.")
        return {**match, "other_user_id": other_id}

    @app.get("/api/savings/plans")
    def list_savings_plans(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            rows = connection.execute(
                """SELECT plan.id, plan.name, plan.target_amount, plan.contribution_amount,
                          plan.frequency, plan.target_date, plan.active, plan.created_at,
                          COALESCE((
                              SELECT sum(contribution.amount)
                              FROM savings_contributions contribution
                              WHERE contribution.plan_id = plan.id AND contribution.user_id = plan.user_id
                          ), 0) AS saved_amount
                   FROM savings_plans plan
                   WHERE plan.user_id = %s
                   ORDER BY plan.created_at DESC""",
                (user["id"],),
            ).fetchall()
        return {"plans": rows}

    @app.post(
        "/api/savings/plans",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def create_savings_plan(
        input: SavingsPlanInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        if input.target_date and input.target_date < date.today():
            raise ApiError(400, "invalid_target_date", "The target date cannot be in the past.")
        with database.connection() as connection:
            row = connection.execute(
                """INSERT INTO savings_plans
                       (user_id, name, target_amount, contribution_amount, frequency, target_date)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   RETURNING id, name, target_amount, contribution_amount, frequency,
                             target_date, active, created_at""",
                (
                    user["id"], input.name, input.target_amount, input.contribution_amount,
                    input.frequency, input.target_date,
                ),
            ).fetchone()
        if not row:
            raise ApiError(500, "internal_error", "The savings plan could not be created.")
        return {"plan": {**row, "saved_amount": 0}}

    @app.post(
        "/api/savings/plans/{plan_id}/contributions",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def add_savings_contribution(
        plan_id: UUID,
        input: SavingsContributionInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """INSERT INTO savings_contributions (plan_id, user_id, amount, note)
                   SELECT id, user_id, %s, %s
                   FROM savings_plans
                   WHERE id = %s AND user_id = %s AND active
                   RETURNING id, plan_id, amount, note, contributed_at""",
                (input.amount, input.note, plan_id, user["id"]),
            ).fetchone()
        if not row:
            raise ApiError(404, "savings_plan_not_found", "That active savings plan could not be found.")
        return {"contribution": row}

    @app.get("/api/savings/plans/{plan_id}/contributions")
    def list_savings_contributions(
        plan_id: UUID,
        limit: int = Query(default=50, ge=1, le=100),
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            plan = connection.execute(
                "SELECT id FROM savings_plans WHERE id = %s AND user_id = %s",
                (plan_id, user["id"]),
            ).fetchone()
            if not plan:
                raise ApiError(404, "savings_plan_not_found", "That savings plan could not be found.")
            rows = connection.execute(
                """SELECT id, amount, note, contributed_at
                   FROM savings_contributions
                   WHERE plan_id = %s AND user_id = %s
                   ORDER BY contributed_at DESC, id DESC
                   LIMIT %s""",
                (plan_id, user["id"], limit),
            ).fetchall()
        return {"contributions": rows}

    @app.put(
        "/api/savings/plans/{plan_id}/active",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def set_savings_plan_active(
        plan_id: UUID,
        active: bool,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            row = connection.execute(
                """UPDATE savings_plans SET active = %s, updated_at = now()
                   WHERE id = %s AND user_id = %s
                   RETURNING id, active""",
                (active, plan_id, user["id"]),
            ).fetchone()
        if not row:
            raise ApiError(404, "savings_plan_not_found", "That savings plan could not be found.")
        return {"plan": row}

    @app.delete(
        "/api/savings/plans/{plan_id}",
        status_code=204,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def delete_savings_plan(
        plan_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Response:
        with database.connection() as connection:
            row = connection.execute(
                "DELETE FROM savings_plans WHERE id = %s AND user_id = %s RETURNING id",
                (plan_id, user["id"]),
            ).fetchone()
        if not row:
            raise ApiError(404, "savings_plan_not_found", "That savings plan could not be found.")
        return Response(status_code=204)

    @app.get("/api/dating/profile")
    def read_dating_profile(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            row = get_dating_profile(connection, user["id"])
        return {"profile": public_dating_profile(row) if row else None}

    @app.put(
        "/api/dating/profile",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def save_dating_profile(
        input: DatingProfileInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        if not input.agree_to_adult_terms:
            raise ApiError(400, "adult_terms_required", "Confirm that you are 18 or older to continue.")
        with database.connection() as connection:
            existing = connection.execute(
                "SELECT birth_date FROM dating_profiles WHERE user_id = %s",
                (user["id"],),
            ).fetchone()
        birth_date = input.birth_date or (existing["birth_date"] if existing else None)
        if not birth_date:
            raise ApiError(400, "birth_date_required", "Enter your date of birth to create a dating profile.")
        today = date.today()
        age = today.year - birth_date.year - (
            (today.month, today.day) < (birth_date.month, birth_date.day)
        )
        if age < 18:
            raise ApiError(403, "adult_only", "Dating is available only to adults aged 18 or older.")
        if age > 120 or birth_date > today:
            raise ApiError(400, "invalid_birth_date", "Enter a valid date of birth.")
        with database.connection() as connection:
            connection.execute(
                """INSERT INTO dating_profiles
                       (user_id, birth_date, gender, seeking, location, bio, interests, image_urls, active)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (user_id) DO UPDATE SET
                       birth_date = EXCLUDED.birth_date,
                       gender = EXCLUDED.gender,
                       seeking = EXCLUDED.seeking,
                       location = EXCLUDED.location,
                       bio = EXCLUDED.bio,
                       interests = EXCLUDED.interests,
                       image_urls = EXCLUDED.image_urls,
                       active = EXCLUDED.active,
                       terms_accepted_at = now(),
                       updated_at = now()""",
                (
                    user["id"], birth_date, input.gender, input.seeking, input.location,
                    input.bio, input.interests, input.image_urls, input.active,
                ),
            )
            row = get_dating_profile(connection, user["id"])
        if not row:
            raise ApiError(500, "internal_error", "The dating profile could not be loaded.")
        return {"profile": public_dating_profile(row)}

    @app.get("/api/dating/discovery")
    def discover_dating_profiles(
        limit: int = Query(default=20, ge=1, le=50),
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            own = require_active_dating_profile(connection, user["id"])
            rows = connection.execute(
                """SELECT profile.user_id, profile.birth_date, profile.gender, profile.seeking,
                          profile.location, profile.bio, profile.interests, profile.image_urls,
                          profile.active, account.display_name, account.username
                   FROM dating_profiles profile
                   JOIN users account ON account.id = profile.user_id
                   WHERE profile.active
                     AND account.email_verified_at IS NOT NULL
                     AND account.profile_visible AND account.discoverable
                     AND profile.user_id <> %s
                     AND (
                         profile.seeking = 'everyone'
                         OR (profile.seeking = 'women' AND %s = 'woman')
                         OR (profile.seeking = 'men' AND %s = 'man')
                         OR (profile.seeking = 'non_binary' AND %s = 'non_binary')
                     )
                     AND (
                         %s = 'everyone'
                         OR (%s = 'women' AND profile.gender = 'woman')
                         OR (%s = 'men' AND profile.gender = 'man')
                         OR (%s = 'non_binary' AND profile.gender = 'non_binary')
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM dating_swipes swipe
                         WHERE swipe.user_id = %s AND swipe.target_user_id = profile.user_id
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM dating_blocks dating_block
                         WHERE (dating_block.blocker_id = %s AND dating_block.blocked_id = profile.user_id)
                            OR (dating_block.blocker_id = profile.user_id AND dating_block.blocked_id = %s)
                     )
                   ORDER BY EXISTS (
                       SELECT 1
                       FROM dating_entitlements entitlement
                       JOIN dating_billing_products product ON product.id = entitlement.product_id
                       WHERE entitlement.user_id = profile.user_id
                         AND product.code = 'profile_boost'
                         AND entitlement.expires_at > now()
                   ) DESC, profile.updated_at DESC, profile.user_id
                   LIMIT %s""",
                (
                    user["id"], own["gender"], own["gender"], own["gender"],
                    own["seeking"], own["seeking"], own["seeking"], own["seeking"],
                    user["id"], user["id"], user["id"], limit,
                ),
            ).fetchall()
        return {"profiles": [public_dating_profile(row) for row in rows]}

    @app.post(
        "/api/dating/profiles/{target_user_id}/swipe",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def swipe_dating_profile(
        target_user_id: UUID,
        input: DatingLikeInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        if str(target_user_id) == str(user["id"]):
            raise ApiError(400, "invalid_dating_target", "You cannot swipe on your own profile.")
        with database.connection() as connection:
            connection.execute(
                """SELECT user_id FROM dating_profiles
                   WHERE user_id IN (%s, %s)
                   ORDER BY user_id
                   FOR UPDATE""",
                (user["id"], target_user_id),
            )
            own = require_active_dating_profile(connection, user["id"])
            target = connection.execute(
                """SELECT profile.user_id, profile.gender, profile.seeking, profile.active
                   FROM dating_profiles profile
                   JOIN users account ON account.id = profile.user_id
                   WHERE profile.user_id = %s AND profile.active
                     AND account.email_verified_at IS NOT NULL
                     AND account.profile_visible AND account.discoverable""",
                (target_user_id,),
            ).fetchone()
            if not target:
                raise ApiError(404, "dating_profile_not_found", "That dating profile could not be found.")
            own_accepts_target = own["seeking"] == "everyone" or (
                own["seeking"] == "women" and target["gender"] == "woman"
            ) or (own["seeking"] == "men" and target["gender"] == "man") or (
                own["seeking"] == "non_binary" and target["gender"] == "non_binary"
            )
            target_accepts_own = target["seeking"] == "everyone" or (
                target["seeking"] == "women" and own["gender"] == "woman"
            ) or (target["seeking"] == "men" and own["gender"] == "man") or (
                target["seeking"] == "non_binary" and own["gender"] == "non_binary"
            )
            if not own_accepts_target or not target_accepts_own:
                raise ApiError(404, "dating_profile_not_found", "That dating profile could not be found.")
            blocked = connection.execute(
                """SELECT 1 FROM dating_blocks
                   WHERE (blocker_id = %s AND blocked_id = %s)
                      OR (blocker_id = %s AND blocked_id = %s)
                   LIMIT 1""",
                (user["id"], target_user_id, target_user_id, user["id"]),
            ).fetchone()
            if blocked:
                raise ApiError(404, "dating_profile_not_found", "That dating profile could not be found.")
            if input.liked:
                previous_swipe = connection.execute(
                    """SELECT liked FROM dating_swipes
                       WHERE user_id = %s AND target_user_id = %s""",
                    (user["id"], target_user_id),
                ).fetchone()
                if not previous_swipe or not previous_swipe["liked"]:
                    quota_settings = connection.execute(
                        """SELECT free_daily_dating_likes
                           FROM posting_quota_settings WHERE id = 1"""
                    ).fetchone()
                    if not quota_settings:
                        raise ApiError(503, "billing_not_configured", "Dating allowances are unavailable.")
                    used_likes = connection.execute(
                        """SELECT count(*) AS used
                           FROM dating_swipes
                           WHERE user_id = %s AND liked
                             AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'""",
                        (user["id"],),
                    ).fetchone()
                    if int(used_likes["used"]) >= int(quota_settings["free_daily_dating_likes"]):
                        credit = connection.execute(
                            """SELECT entitlement.id
                               FROM dating_entitlements entitlement
                               JOIN dating_billing_products product ON product.id = entitlement.product_id
                               WHERE entitlement.user_id = %s
                                 AND product.code = 'extra_likes'
                                 AND entitlement.quantity_remaining > 0
                                 AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
                               ORDER BY entitlement.created_at
                               LIMIT 1 FOR UPDATE OF entitlement""",
                            (user["id"],),
                        ).fetchone()
                        if not credit:
                            raise ApiError(
                                402,
                                "dating_likes_limit_reached",
                                "You’ve used today’s free likes. Get an extra-likes pack or come back tomorrow.",
                            )
                        connection.execute(
                            """UPDATE dating_entitlements
                               SET quantity_remaining = quantity_remaining - 1
                               WHERE id = %s""",
                            (credit["id"],),
                        )
            connection.execute(
                """INSERT INTO dating_swipes (user_id, target_user_id, liked)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (user_id, target_user_id) DO UPDATE
                   SET liked = EXCLUDED.liked, created_at = now()""",
                (user["id"], target_user_id, input.liked),
            )
            mutual_match = connection.execute(
                """SELECT 1 FROM dating_swipes
                   WHERE user_id = %s AND target_user_id = %s AND liked""",
                (target_user_id, user["id"]),
            ).fetchone() if input.liked else None
            match_id = None
            if mutual_match:
                match_row = connection.execute(
                    """INSERT INTO dating_matches (participant_one_id, participant_two_id)
                       VALUES (LEAST(%s, %s), GREATEST(%s, %s))
                       ON CONFLICT (participant_one_id, participant_two_id) DO NOTHING
                       RETURNING id""",
                    (user["id"], target_user_id, user["id"], target_user_id),
                ).fetchone()
                if match_row:
                    match_id = match_row["id"]
                else:
                    existing = connection.execute(
                        """SELECT id FROM dating_matches
                           WHERE participant_one_id = LEAST(%s, %s)
                             AND participant_two_id = GREATEST(%s, %s)""",
                        (user["id"], target_user_id, user["id"], target_user_id),
                    ).fetchone()
                    match_id = existing["id"] if existing else None
        return {"liked": input.liked, "matched": bool(mutual_match), "match_id": match_id}

    @app.get("/api/dating/matches")
    def list_dating_matches(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
        with database.connection() as connection:
            own = get_dating_profile(connection, user["id"])
            if not own:
                raise ApiError(403, "dating_profile_required", "Create your dating profile before using this feature.")
            today = date.today()
            age = today.year - own["birth_date"].year - (
                (today.month, today.day) < (own["birth_date"].month, own["birth_date"].day)
            )
            if age < 18:
                raise ApiError(403, "adult_only", "Dating is available only to adults aged 18 or older.")
            rows = connection.execute(
                """SELECT dating_match.id, dating_match.created_at,
                          other.id AS user_id, other.display_name, other.username,
                          profile.birth_date, profile.gender, profile.seeking,
                          profile.location, profile.bio, profile.interests, profile.image_urls,
                          profile.active,
                          latest.body AS last_message, latest.created_at AS last_message_at
                   FROM dating_matches dating_match
                   JOIN users other ON other.id = CASE
                       WHEN dating_match.participant_one_id = %s THEN dating_match.participant_two_id
                       ELSE dating_match.participant_one_id
                   END
                   JOIN dating_profiles profile ON profile.user_id = other.id
                   LEFT JOIN LATERAL (
                       SELECT body, created_at FROM dating_messages
                       WHERE match_id = dating_match.id
                       ORDER BY created_at DESC, id DESC LIMIT 1
                   ) latest ON true
                   WHERE (dating_match.participant_one_id = %s OR dating_match.participant_two_id = %s)
                     AND NOT EXISTS (
                         SELECT 1 FROM dating_blocks dating_block
                         WHERE (dating_block.blocker_id = %s AND dating_block.blocked_id = other.id)
                            OR (dating_block.blocker_id = other.id AND dating_block.blocked_id = %s)
                     )
                   ORDER BY COALESCE(latest.created_at, dating_match.created_at) DESC""",
                (user["id"], user["id"], user["id"], user["id"], user["id"]),
            ).fetchall()
        matches = []
        for row in rows:
            match_profile = public_dating_profile({
                **row,
                "user_id": row["user_id"],
            })
            matches.append({
                "id": row["id"],
                "created_at": row["created_at"],
                "profile": match_profile,
                "last_message": row["last_message"],
                "last_message_at": row["last_message_at"],
            })
        return {"matches": matches}

    @app.get("/api/dating/matches/{match_id}/messages")
    def list_dating_messages(
        match_id: UUID,
        limit: int = Query(default=100, ge=1, le=200),
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            match = require_dating_match(connection, match_id, user["id"])
            rows = connection.execute(
                """SELECT message.id, message.sender_id, message.body, message.created_at,
                          account.display_name AS sender_name
                   FROM (
                       SELECT id, sender_id, body, created_at
                       FROM dating_messages WHERE match_id = %s
                       ORDER BY created_at DESC, id DESC LIMIT %s
                   ) message
                   JOIN users account ON account.id = message.sender_id
                   ORDER BY message.created_at, message.id""",
                (match_id, limit),
            ).fetchall()
            connection.execute(
                """UPDATE dating_messages SET read_at = now()
                   WHERE match_id = %s AND sender_id = %s AND read_at IS NULL""",
                (match_id, match["other_user_id"]),
            )
        return {"messages": rows}

    @app.post(
        "/api/dating/matches/{match_id}/messages",
        status_code=201,
        dependencies=[Depends(enforce_message_rate_limit)],
    )
    def send_dating_message(
        match_id: UUID,
        input: DatingMessageInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, Any]:
        with database.connection() as connection:
            require_dating_match(connection, match_id, user["id"])
            inserted = connection.execute(
                """INSERT INTO dating_messages (match_id, sender_id, body)
                   VALUES (%s, %s, %s)
                   RETURNING id, sender_id, body, created_at""",
                (match_id, user["id"], input.text),
            ).fetchone()
        if not inserted:
            raise ApiError(500, "internal_error", "The dating message could not be sent.")
        return {"message": inserted}

    @app.delete(
        "/api/dating/matches/{match_id}",
        status_code=204,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def unmatch_dating_user(
        match_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Response:
        with database.connection() as connection:
            row = connection.execute(
                """DELETE FROM dating_matches
                   WHERE id = %s AND (participant_one_id = %s OR participant_two_id = %s)
                   RETURNING id""",
                (match_id, user["id"], user["id"]),
            ).fetchone()
        if not row:
            raise ApiError(404, "dating_match_not_found", "That dating match could not be found.")
        return Response(status_code=204)

    @app.post(
        "/api/dating/users/{target_user_id}/block",
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def block_dating_user(
        target_user_id: UUID,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, bool]:
        if str(target_user_id) == str(user["id"]):
            raise ApiError(400, "invalid_dating_target", "You cannot block your own profile.")
        with database.connection() as connection:
            target = connection.execute(
                "SELECT user_id FROM dating_profiles WHERE user_id = %s",
                (target_user_id,),
            ).fetchone()
            if not target:
                raise ApiError(404, "dating_profile_not_found", "That dating profile could not be found.")
            connection.execute(
                """INSERT INTO dating_blocks (blocker_id, blocked_id)
                   VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                (user["id"], target_user_id),
            )
            connection.execute(
                """DELETE FROM dating_matches
                   WHERE (participant_one_id = %s AND participant_two_id = %s)
                      OR (participant_one_id = %s AND participant_two_id = %s)""",
                (user["id"], target_user_id, target_user_id, user["id"]),
            )
        return {"blocked": True}

    @app.post(
        "/api/dating/users/{target_user_id}/report",
        status_code=201,
        dependencies=[Depends(enforce_social_rate_limit)],
    )
    def report_dating_user(
        target_user_id: UUID,
        input: DatingReportInput,
        user: Dict[str, Any] = Depends(require_user),
    ) -> Dict[str, bool]:
        if str(target_user_id) == str(user["id"]):
            raise ApiError(400, "invalid_dating_target", "You cannot report your own profile.")
        with database.connection() as connection:
            target = connection.execute(
                "SELECT user_id FROM dating_profiles WHERE user_id = %s",
                (target_user_id,),
            ).fetchone()
            if not target:
                raise ApiError(404, "dating_profile_not_found", "That dating profile could not be found.")
            connection.execute(
                """INSERT INTO dating_reports (reporter_id, reported_id, reason, details)
                   VALUES (%s, %s, %s, %s)""",
                (user["id"], target_user_id, input.reason, input.details),
            )
        return {"reported": True}

    register_trading_routes(
        app,
        database=database,
        require_user=require_user,
        rate_limit=enforce_social_rate_limit,
        api_error=ApiError,
        market=DerivMarketData(),
        deriv=DerivAccount(settings.deriv_app_id, settings.deriv_api_token, settings.deriv_account_id),
        # The Deriv token belongs to the site owner, so only admin emails may trade with it.
        is_owner=lambda user: str(user.get("email") or "").strip().lower() in settings.admin_emails,
    )

    return app


app = create_app()
