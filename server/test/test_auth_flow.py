import re
import os
import json
import logging
import unittest
import tempfile
from contextlib import contextmanager
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("OTP_HASH_SECRET", "test-otp-secret-that-is-long-enough")
os.environ.setdefault("SESSION_SECRET", "test-session-secret-that-is-long-enough")

from server.app.main import Settings, _send_otp_email, create_app
from server.app.security import hash_email_code


class FakeResult:
    def __init__(self, row=None, rows=None, rowcount=None):
        self.rows = rows or []
        self.row = row if row is not None else (self.rows[0] if self.rows else None)
        self.rowcount = rowcount if rowcount is not None else (1 if row else 0)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, state):
        self.state = state

    @contextmanager
    def transaction(self):
        yield self

    def execute(self, query, parameters=()):
        sql = re.sub(r"\s+", " ", query).strip().lower()
        if sql.startswith("select pg_advisory_xact_lock"):
            return FakeResult()
        if "from posting_quota_settings" in sql:
            return FakeResult({"free_monthly_limits": self.state.get("free_monthly_limits", {
                "jobs": 100, "products": 100, "marketplace": 100, "videos": 100,
            })})
        if sql.startswith("select plan.posting_limits from billing_subscriptions"):
            return FakeResult()
        if sql.startswith("select count(*) as used from posting_usage"):
            user_id, category = map(str, parameters)
            used = sum(1 for entry in self.state.get("posting_usage", [])
                       if entry["user_id"] == user_id and entry["category"] == category)
            return FakeResult({"used": used})
        if sql.startswith("insert into posting_usage"):
            user_id, category, content_id = map(str, parameters)
            self.state.setdefault("posting_usage", []).append({
                "user_id": user_id, "category": category, "content_id": content_id,
            })
            return FakeResult()
        if sql.startswith("insert into admin_audit_log"):
            action = next(
                (name for name in (
                    "view_user_details",
                    "grant_subadmin",
                    "revoke_subadmin",
                    "delete_content",
                    "update_product",
                    "update_user_status",
                    "create_admin_content",
                    "edit_user_post",
                    "view_business_document",
                ) if name in sql),
                "unknown",
            )
            event = {
                "id": str(uuid4()),
                "admin_user_id": str(parameters[0]),
                "subject_user_id": str(parameters[1]) if len(parameters) > 1 else None,
                "action": action,
                "details": {},
                "created_at": datetime.now(timezone.utc),
            }
            self.state["admin_audit"].append(event)
            return FakeResult({"id": event["id"]})
        if sql.startswith("select user_id from admin_roles"):
            self.state["admin_role_lookups"] += 1
            user_id = str(parameters[0])
            return FakeResult({"user_id": user_id} if user_id in self.state["admin_roles"] else None)
        if sql.startswith("select * from job_business_profiles"):
            profile = self.state["business_profiles"].get(str(parameters[0]))
            return FakeResult(profile.copy() if profile else None)
        if sql.startswith("select document_filename from job_business_profiles"):
            profile = self.state["business_profiles"].get(str(parameters[0]))
            return FakeResult(
                {"document_filename": profile["document_filename"]}
                if profile else None
            )
        if sql.startswith("select document_filename, document_content_type from job_business_profiles"):
            profile = self.state["business_profiles"].get(str(parameters[0]))
            return FakeResult({
                "document_filename": profile["document_filename"],
                "document_content_type": profile["document_content_type"],
            } if profile else None)
        if sql.startswith("insert into job_business_profiles"):
            profile = {
                "user_id": str(parameters[0]),
                "company_name": parameters[1],
                "registration_number": parameters[2],
                "business_type": parameters[3],
                "business_address": parameters[4],
                "contact_phone": parameters[5],
                "description": parameters[6],
                "document_filename": parameters[7],
                "document_content_type": parameters[8],
                "document_size": parameters[9],
                "submitted_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            self.state["business_profiles"][str(parameters[0])] = profile
            return FakeResult(profile.copy())
        if "from admin_roles roles" in sql and "creator.display_name" in sql:
            return FakeResult(rows=[])
        if "from admin_audit_log log" in sql:
            return FakeResult(rows=[
                {
                    "id": event["id"],
                    "action": event["action"],
                    "details": event.get("details", {}),
                    "created_at": event["created_at"],
                    "admin_id": self.state["user"]["id"],
                    "admin_name": self.state["user"]["display_name"],
                    "admin_email": self.state["user"]["email"],
                    "subject_id": event["subject_user_id"],
                    "subject_name": self.state["user"]["display_name"],
                    "subject_email": self.state["user"]["email"],
                }
                for event in reversed(self.state["admin_audit"])
            ][:parameters[0]])
        if sql.startswith("select (select count(*) from users) as users"):
            return FakeResult({
                "users": 1,
                "verified_users": 1,
                "posts": 0,
                "comments": 0,
                "likes": 0,
                "bookmarks": 0,
                "messages": 1,
                "products": 0,
                "local_listings": 0,
                "jobs": 0,
                "applications": 0,
                "communities": 0,
                "memberships": 0,
                "new_users_7d": 1,
                "new_posts_7d": 0,
                "new_products_7d": 0,
                "new_jobs_7d": 0,
            })
        if sql.startswith("select count(*) as total from users u"):
            return FakeResult({"total": 1})
        if sql.startswith("select count(*) as total from social_posts p join users u"):
            return FakeResult({"total": 0})
        if sql.startswith("select p.id, p.body as title, u.display_name as owner"):
            return FakeResult(rows=[])
        if sql.startswith("select u.id") and "from users u" in sql and "order by u.created_at" in sql:
            return FakeResult(rows=[self._admin_user_row()])
        if (
            sql.startswith("select id, display_name, username, email, bio, interests,")
            and "from users where id = %s" in sql
        ):
            user = self.state["user"]
            return FakeResult(user.copy() if user and str(user["id"]) == str(parameters[0]) else None)
        if sql.startswith("select (select count(*) from social_posts where user_id"):
            return FakeResult({
                "posts": 0,
                "comments": 0,
                "likes": 0,
                "bookmarks": 0,
                "messages": 1,
                "products": 0,
                "local_listings": 0,
                "jobs": 0,
                "applications": 0,
                "communities_created": 0,
                "communities_joined": 0,
                "following": 0,
                "followers": 0,
            })
        if (
            "from community_memberships membership" in sql
            and not sql.startswith((
                "select c.owner_id, c.members_can_post",
                "select member.id",
            ))
        ):
            return FakeResult(rows=[])
        if "from communities c where c.owner_id = %s" in sql:
            return FakeResult(rows=[])
        if sql.startswith("select m.id, m.conversation_id") and "from direct_messages m" in sql:
            user = self.state["user"]
            return FakeResult(rows=[{
                "id": "00000000-0000-0000-0000-000000000099",
                "conversation_id": "00000000-0000-0000-0000-000000000098",
                "body": "Private test message",
                "image_url": "/api/media/images/{}".format("f" * 32),
                "created_at": datetime.now(timezone.utc),
                "read_at": None,
                "sender_id": user["id"],
                "sender_name": user["display_name"],
                "sender_username": user["username"],
                "recipient_id": user["id"],
                "recipient_name": user["display_name"],
                "recipient_username": user["username"],
            }])
        if any(sql.startswith(prefix) for prefix in (
            "select l.created_at, p.id as post_id",
            "select b.created_at, p.id as post_id",
            "select id, name, category, price, stock",
            "select id, category, title, price, location",
            "select id, title, company, location, employment_type",
            "select a.id, a.job_id, a.cover_letter",
            "select followed.id, followed.display_name",
            "select follower.id, follower.display_name",
        )):
            return FakeResult(rows=[])
        if sql.startswith("insert into videos"):
            video = {
                "id": str(uuid4()),
                "user_id": str(parameters[0]),
                "title": parameters[1],
                "caption": parameters[2],
                "filename": parameters[3],
                "content_type": parameters[4],
                "file_size": parameters[5],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["videos"].append(video)
            return FakeResult({"id": video["id"]})
        if sql.startswith("select video.id, video.user_id"):
            if "where video.id = %s" in sql:
                video_id = str(parameters[0])
                video = next((item for item in self.state["videos"] if item["id"] == video_id), None)
                return FakeResult(self._video_row(video) if video else None)
            videos = list(reversed(self.state["videos"]))
            parameter_index = 0
            if "video.user_id = %s" in sql:
                owner_id = str(parameters[parameter_index])
                parameter_index += 1
                videos = [item for item in videos if item["user_id"] == owner_id]
            if "strpos(lower(video.title" in sql:
                term = parameters[parameter_index]
                parameter_index += 1
                videos = [
                    item for item in videos
                    if term in "{} {} {}".format(
                        item["title"],
                        item["caption"],
                        self.state["user"]["display_name"],
                    ).lower()
                ]
            return FakeResult(rows=[self._video_row(video) for video in videos[:parameters[parameter_index]]])
        if sql.startswith("select filename, content_type from videos"):
            video_id = str(parameters[0])
            video = next((item for item in self.state["videos"] if item["id"] == video_id), None)
            return FakeResult({
                "filename": video["filename"],
                "content_type": video["content_type"],
            } if video else None)
        if sql.startswith("delete from videos"):
            video_id, user_id = map(str, parameters)
            video = next(
                (
                    item for item in self.state["videos"]
                    if item["id"] == video_id and item["user_id"] == user_id
                ),
                None,
            )
            if not video:
                return FakeResult()
            self.state["videos"].remove(video)
            return FakeResult({"filename": video["filename"]})
        if sql.startswith("insert into social_posts"):
            post = {
                "id": str(uuid4()),
                "user_id": str(parameters[0]),
                "body": parameters[1],
                "image_urls": parameters[2],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["posts"].append(post)
            return FakeResult({"id": post["id"]})
        if sql.startswith("update social_posts set body"):
            if len(parameters) == 3:
                text, image_urls, post_id = parameters
                post = next((item for item in self.state["posts"] if item["id"] == str(post_id)), None)
                if not post:
                    return FakeResult()
                post["body"] = text
                post["image_urls"] = image_urls
                return FakeResult({
                    "id": post["id"],
                    "user_id": post["user_id"],
                    "created_at": post["created_at"],
                })
            text, image_urls, post_id, user_id = parameters
            post = next(
                (
                    item for item in self.state["posts"]
                    if item["id"] == str(post_id) and item["user_id"] == str(user_id)
                ),
                None,
            )
            if not post:
                return FakeResult()
            post["body"] = text
            post["image_urls"] = image_urls
            return FakeResult({"id": post["id"]})
        if sql.startswith("delete from social_posts"):
            post_id, user_id = map(str, parameters)
            post = next(
                (
                    item for item in self.state["posts"]
                    if item["id"] == post_id and item["user_id"] == user_id
                ),
                None,
            )
            if not post:
                return FakeResult()
            self.state["posts"].remove(post)
            self.state["comments"] = [
                comment for comment in self.state["comments"]
                if comment["post_id"] != post_id
            ]
            self.state["likes"] = {
                like for like in self.state["likes"] if like[0] != post_id
            }
            self.state["bookmarks"] = {
                bookmark for bookmark in self.state["bookmarks"] if bookmark[0] != post_id
            }
            return FakeResult({"id": post_id})
        if (
            sql.startswith("select p.id, p.body, p.image_urls, p.created_at")
            and "where p.user_id = %s" in sql
        ):
            user_id, limit, offset = map(str, parameters)
            posts = [post for post in self.state["posts"] if post["user_id"] == user_id]
            posts.sort(key=lambda post: post["created_at"], reverse=True)
            return FakeResult(rows=[
                {
                    **post,
                    "like_count": 0,
                    "comment_count": 0,
                }
                for post in posts[int(offset):int(offset) + int(limit)]
            ])
        if sql.startswith("insert into marketplace_products"):
            product = {
                "id": str(uuid4()),
                "seller_id": str(parameters[0]),
                "name": parameters[1],
                "category": parameters[2],
                "price": parameters[3],
                "stock": parameters[4],
                "description": parameters[5],
                "image_url": parameters[6],
                "image_urls": parameters[7],
                "created_at": datetime.now(timezone.utc),
                "published": parameters[8] if len(parameters) > 8 else True,
            }
            self.state["products"].append(product)
            return FakeResult({"id": product["id"]})
        if sql.startswith("update marketplace_products"):
            name, category, price, stock, description, image_url, image_urls, product_id, seller_id = parameters
            product = next(
                (item for item in self.state["products"]
                 if item["id"] == str(product_id) and item["seller_id"] == str(seller_id)),
                None,
            )
            if not product:
                return FakeResult()
            product.update({
                "name": name,
                "category": category,
                "price": price,
                "stock": stock,
                "description": description,
                "image_url": image_url,
                "image_urls": image_urls,
            })
            return FakeResult({"id": product["id"]})
        if sql.startswith("select id from marketplace_orders where product_id ="):
            return FakeResult()
        if sql.startswith("delete from marketplace_products"):
            product_id, seller_id = map(str, parameters)
            product = next(
                (item for item in self.state["products"]
                 if item["id"] == product_id and item["seller_id"] == seller_id),
                None,
            )
            if not product:
                return FakeResult()
            self.state["products"].remove(product)
            return FakeResult({"id": product_id})
        if sql.startswith("insert into user_statuses"):
            status = {
                "id": str(uuid4()),
                "user_id": str(parameters[0]),
                "image_url": parameters[1],
                "caption": parameters[2],
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(hours=24),
            }
            self.state["statuses"].append(status)
            return FakeResult({"id": status["id"]})
        if sql.startswith("select status.id") and "from user_statuses status" in sql:
            if "false as viewed_by_me" in sql:
                status = next(
                    (item for item in self.state["statuses"]
                     if item["id"] == str(parameters[0])
                     and item["user_id"] == str(parameters[1])),
                    None,
                )
                if not status:
                    return FakeResult()
                row = self._status_row(status, parameters[1])
                row["viewed_by_me"] = False
                row["is_mine"] = True
                row["view_count"] = 0
                return FakeResult(row)
            viewer_id = str(parameters[0])
            if "where status.id = %s" in sql:
                status = next(
                    (item for item in self.state["statuses"]
                     if item["id"] == str(parameters[2])),
                    None,
                )
                return FakeResult(self._status_row(status, viewer_id) if status else None)
            user_id_filter = str(parameters[2]) if parameters[2] else None
            statuses = [
                item for item in self.state["statuses"]
                if item["expires_at"] > datetime.now(timezone.utc)
                and (user_id_filter is None or item["user_id"] == user_id_filter)
            ]
            return FakeResult(rows=[self._status_row(item, viewer_id) for item in statuses])
        if sql.startswith("select viewer.id") and "from user_status_views" in sql:
            return FakeResult(rows=[])
        if sql.startswith("insert into user_status_views"):
            status_id, viewer_id = map(str, parameters)
            if not any(
                item["status_id"] == status_id and item["viewer_id"] == viewer_id
                for item in self.state["status_views"]
            ):
                self.state["status_views"].append({
                    "status_id": status_id,
                    "viewer_id": viewer_id,
                    "viewed_at": datetime.now(timezone.utc),
                })
            return FakeResult()
        if sql.startswith("delete from user_statuses where expires_at <= now()"):
            self.state["statuses"] = [
                status for status in self.state["statuses"]
                if status["expires_at"] > datetime.now(timezone.utc)
            ]
            return FakeResult()
        if sql.startswith("delete from user_statuses"):
            status_id, owner_id = map(str, parameters)
            status = next(
                (item for item in self.state["statuses"]
                 if item["id"] == status_id and item["user_id"] == owner_id),
                None,
            )
            if not status:
                return FakeResult()
            self.state["statuses"].remove(status)
            self.state["status_views"] = [
                view for view in self.state["status_views"]
                if view["status_id"] != status_id
            ]
            return FakeResult({"id": status_id})
        if sql.startswith("insert into local_marketplace_listings"):
            listing = {
                "id": str(uuid4()),
                "seller_id": str(parameters[0]),
                "category": parameters[1],
                "title": parameters[2],
                "price": parameters[3],
                "location": parameters[4],
                "detail": parameters[5],
                "description": parameters[6],
                "image_url": parameters[7],
                "created_at": datetime.now(timezone.utc),
                "published": True,
            }
            self.state["local_listings"].append(listing)
            return FakeResult({"id": listing["id"]})
        if sql.startswith("insert into communities"):
            community = {
                "id": str(uuid4()),
                "owner_id": str(parameters[0]),
                "name": parameters[1],
                "description": parameters[2],
                "image_url": parameters[3],
                "rules": parameters[4],
                "members_can_post": parameters[5],
                "membership_mode": parameters[6],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["communities"].append(community)
            return FakeResult({"id": community["id"]})
        if sql.startswith("update communities"):
            community = next(
                (
                    item for item in self.state["communities"]
                    if item["id"] == str(parameters[6])
                    and item["owner_id"] == str(parameters[7])
                ),
                None,
            )
            if not community:
                return FakeResult()
            community.update({
                "name": parameters[0],
                "description": parameters[1],
                "image_url": parameters[2],
                "rules": parameters[3],
                "members_can_post": parameters[4],
                "membership_mode": parameters[5],
            })
            return FakeResult({"id": community["id"]})
        if sql.startswith("select c.owner_id, c.members_can_post"):
            community = next(
                (item for item in self.state["communities"] if item["id"] == str(parameters[1])),
                None,
            )
            if not community:
                return FakeResult()
            return FakeResult({
                "owner_id": community["owner_id"],
                "members_can_post": community.get("members_can_post", True),
                "joined_by_me": (
                    (community["id"], str(parameters[0])) in self.state["community_memberships"]
                ),
            })
        if sql.startswith("select id, owner_id, membership_mode from communities where id = %s"):
            community = next(
                (item for item in self.state["communities"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult(
                {
                    "id": community["id"],
                    "owner_id": community["owner_id"],
                    "membership_mode": community["membership_mode"],
                }
                if community else None
            )
        if sql.startswith("select id, owner_id from communities where id = %s"):
            community = next(
                (item for item in self.state["communities"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult(
                {"id": community["id"], "owner_id": community["owner_id"]}
                if community else None
            )
        if sql.startswith("select owner_id from communities where id = %s"):
            community = next(
                (item for item in self.state["communities"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult({"owner_id": community["owner_id"]} if community else None)
        if sql.startswith("insert into community_memberships"):
            self.state["community_memberships"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("select user_id from community_memberships"):
            membership = (str(parameters[0]), str(parameters[1]))
            return FakeResult({"user_id": membership[1]} if membership in self.state["community_memberships"] else None)
        if sql.startswith("insert into community_join_requests"):
            key = (str(parameters[0]), str(parameters[1]))
            self.state["community_join_requests"][key] = {
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
            }
            return FakeResult(rowcount=1)
        if sql.startswith("update community_join_requests"):
            if "set status = 'approved'" in sql:
                status = "approved"
                community_id, member_id = parameters
            elif "set status = 'cancelled'" in sql:
                status = "cancelled"
                community_id, member_id = parameters
            else:
                status, community_id, member_id = parameters
            key = (str(community_id), str(member_id))
            request = self.state["community_join_requests"].get(key)
            if request and request["status"] == "pending":
                request["status"] = status
            return FakeResult(rowcount=1 if request else 0)
        if sql.startswith("delete from community_memberships"):
            membership = (str(parameters[0]), str(parameters[1]))
            existed = membership in self.state["community_memberships"]
            self.state["community_memberships"].discard(membership)
            return FakeResult({"user_id": membership[1]} if existed else None)
        if sql.startswith("select member.id") and "from community_memberships membership" in sql:
            community_id, owner_id, limit = parameters
            members = [
                (self.state["user"]["id"], self.state["user"])
                for item in self.state["communities"]
                if item["id"] == str(community_id)
            ]
            return FakeResult(rows=[
                {
                    "id": member_id,
                    "display_name": member["display_name"],
                    "username": member["username"],
                    "profile_image_url": member.get("profile_image_url"),
                }
                for member_id, member in members[:limit]
            ])
        if sql.startswith("select requester.id") and "from community_join_requests request" in sql:
            community_id = str(parameters[0])
            requests = [
                (key, request) for key, request in self.state["community_join_requests"].items()
                if key[0] == community_id and request["status"] == "pending"
            ]
            return FakeResult(rows=[
                {
                    "id": key[1],
                    "display_name": self.state["user"]["display_name"],
                    "username": self.state["user"]["username"],
                    "profile_image_url": self.state["user"].get("profile_image_url"),
                    "created_at": request["created_at"],
                }
                for key, request in requests
            ])
        if sql.startswith("select user_id from community_join_requests"):
            request = self.state["community_join_requests"].get(
                (str(parameters[0]), str(parameters[1]))
            )
            return FakeResult(
                {"user_id": str(parameters[1])}
                if request and request["status"] == "pending"
                else None
            )
        if sql.startswith("insert into community_posts"):
            post = {
                "id": str(uuid4()),
                "community_id": str(parameters[0]),
                "user_id": str(parameters[1]),
                "body": parameters[2],
                "image_urls": parameters[3],
                "created_at": datetime.now(timezone.utc),
            }
            self.state["community_posts"].append(post)
            return FakeResult({"id": post["id"]})
        if sql.startswith("select post.id") and "from community_posts post" in sql:
            if "where post.id = %s" in sql:
                posts = list(self.state["community_posts"])
                posts = [post for post in posts if post["id"] == str(parameters[0])]
            else:
                posts = [
                    post for post in self.state["community_posts"]
                    if post["community_id"] == str(parameters[0])
                ]
                posts = sorted(posts, key=lambda post: post["created_at"], reverse=True)
                posts = posts[parameters[2]:parameters[2] + parameters[1]]
            return FakeResult(rows=[
                {
                    "id": post["id"],
                    "body": post["body"],
                    "image_urls": post["image_urls"],
                    "created_at": post["created_at"],
                    "author_id": post["user_id"],
                    "display_name": self.state["user"]["display_name"],
                    "username": self.state["user"]["username"],
                    "author_image_url": self.state["user"].get("profile_image_url"),
                }
                for post in posts
            ])
        if sql.startswith("delete from community_posts"):
            post = next(
                (
                    item for item in self.state["community_posts"]
                    if item["id"] == str(parameters[0])
                    and item["community_id"] == str(parameters[1])
                    and (
                        item["user_id"] == str(parameters[2])
                        or any(
                            community["id"] == item["community_id"]
                            and community["owner_id"] == str(parameters[3])
                            for community in self.state["communities"]
                        )
                    )
                ),
                None,
            )
            if post:
                self.state["community_posts"].remove(post)
            return FakeResult({"id": post["id"]} if post else None)
        if sql.startswith("select c.id") and "from communities c" in sql:
            if "where c.id = %s" in sql:
                viewer_id, viewer_for_request, viewer_for_admin, community_id = parameters
                communities = [
                    item for item in self.state["communities"]
                    if item["id"] == str(community_id)
                ]
            else:
                viewer_id, viewer_for_admin, viewer_for_request, search, _, _, limit = parameters
                communities = self.state["communities"]
                if search:
                    search_text = search.strip("%").lower()
                    communities = [
                        item for item in communities
                        if search_text in item["name"].lower()
                        or search_text in item["description"].lower()
                    ]
                communities = sorted(
                    communities,
                    key=lambda item: item["created_at"],
                    reverse=True,
                )[:limit]
            return FakeResult(rows=[
                self._community_row(item, viewer_id)
                for item in communities
            ])
        if sql.startswith("select id from communities where id = %s"):
            community = next(
                (item for item in self.state["communities"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult({"id": community["id"]} if community else None)
        if sql.startswith("select l.id") and "from local_marketplace_listings l" in sql:
            listings = self.state["local_listings"]
            if "where l.id = %s" in sql:
                listing_id = str(parameters[0])
                listings = [
                    item for item in listings
                    if item["id"] == listing_id and item["published"]
                ]
            else:
                if "l.category = %s" in sql:
                    listings = [item for item in listings if item["category"] == parameters[0]]
                if "lower(l.title) like" in sql:
                    search_index = 1 if "l.category = %s" in sql else 0
                    search = parameters[search_index].strip("%").lower()
                    listings = [
                        item for item in listings
                        if search in item["title"].lower()
                        or search in item["description"].lower()
                        or search in item["detail"].lower()
                        or search in "local seller"
                        or search in "localseller"
                    ]
                if "lower(l.location) like" in sql:
                    location = parameters[-2].strip("%").lower()
                    listings = [item for item in listings if location in item["location"].lower()]
                listings = sorted(
                    listings,
                    key=lambda item: item["created_at"],
                    reverse=True,
                )[:parameters[-1]]
            return FakeResult(rows=[self._local_marketplace_listing_row(item) for item in listings])
        if sql.startswith("select p.id") and "from marketplace_products p" in sql:
            products = self.state["products"]
            if "where p.id = %s" in sql:
                product_id = str(parameters[0])
                products = [
                    item for item in products
                    if item["id"] == product_id and item["published"]
                ]
            else:
                if "p.category = %s" in sql:
                    products = [item for item in products if item["category"] == parameters[0]]
                products = sorted(
                    products,
                    key=lambda item: item["created_at"],
                    reverse=True,
                )[:parameters[-1]]
            return FakeResult(rows=[self._marketplace_product_row(item) for item in products])
        if sql.startswith("select p.id") and "from social_posts p" in sql:
            if "where p.user_id = %s" in sql:
                post_ids = [
                    post["id"] for post in self.state["posts"]
                    if post["user_id"] == str(parameters[0])
                ]
                viewer_id = str(parameters[0])
            elif "where p.id = %s" in sql:
                post_ids = [str(parameters[-1])]
                viewer_id = str(parameters[0])
            else:
                post_ids = [post["id"] for post in self.state["posts"]]
                viewer_id = str(parameters[0])
                if "bookmark_filter.user_id" in sql and parameters[4]:
                    post_ids = [
                        post_id for post_id in post_ids
                        if (post_id, str(parameters[5])) in self.state["bookmarks"]
                    ]
            rows = [
                self._social_post_row(post, viewer_id)
                for post in self.state["posts"]
                if post["id"] in post_ids
            ]
            rows.sort(key=lambda row: row["created_at"], reverse=True)
            if "limit %s" in sql:
                if "where p.user_id = %s" in sql:
                    rows = rows[parameters[2]:parameters[2] + parameters[1]]
                else:
                    rows = rows[:parameters[-1]]
            return FakeResult(rows=rows)
        if sql.startswith("select id from social_posts"):
            post = next(
                (item for item in self.state["posts"] if item["id"] == str(parameters[0])),
                None,
            )
            return FakeResult({"id": post["id"]} if post else None)
        if sql.startswith("insert into social_post_likes"):
            self.state["likes"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("delete from social_post_likes"):
            self.state["likes"].discard((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("insert into social_post_bookmarks"):
            self.state["bookmarks"].add((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("delete from social_post_bookmarks"):
            self.state["bookmarks"].discard((str(parameters[0]), str(parameters[1])))
            return FakeResult(rowcount=1)
        if sql.startswith("select id from social_post_comments"):
            comment_id, post_id = map(str, parameters)
            parent = next(
                (
                    item for item in self.state["comments"]
                    if item["id"] == comment_id
                    and item["post_id"] == post_id
                    and item.get("parent_comment_id") is None
                ),
                None,
            )
            return FakeResult({"id": parent["id"]} if parent else None)
        if sql.startswith("insert into social_post_comments"):
            post_id = str(parameters[3])
            if not any(post["id"] == post_id for post in self.state["posts"]):
                return FakeResult()
            comment = {
                "id": str(uuid4()),
                "post_id": post_id,
                "user_id": str(parameters[0]),
                "body": parameters[1],
                "parent_comment_id": str(parameters[2]) if parameters[2] else None,
                "created_at": datetime.now(timezone.utc),
            }
            self.state["comments"].append(comment)
            return FakeResult({"id": comment["id"]})
        if "from social_post_comments c" in sql:
            if "where c.id = %s" in sql:
                comments = [
                    item for item in self.state["comments"]
                    if item["id"] == str(parameters[0])
                ]
            else:
                comments = [
                    item for item in self.state["comments"]
                    if item["post_id"] == str(parameters[0])
                ]
                comments.sort(key=lambda item: item["created_at"])
                comments = comments[:parameters[-1]]
            return FakeResult(rows=[self._social_comment_row(item) for item in comments])
        if sql.startswith("insert into users"):
            if self.state["user"] and self.state["user"]["email"] == parameters[2]:
                return FakeResult()
            self.state["user"] = {
                "id": "00000000-0000-0000-0000-000000000001",
                "display_name": parameters[0],
                "username": parameters[1],
                "email": parameters[2],
                "password_hash": parameters[3],
                "bio": "",
                "interests": [],
                "profile_image_url": None,
                "profile_visible": True,
                "discoverable": True,
                "email_verified_at": None,
                "suspended_at": None,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            return FakeResult({
                "id": self.state["user"]["id"],
                "display_name": self.state["user"]["display_name"],
                "email": self.state["user"]["email"],
            })
        if sql.startswith("insert into email_verification_codes"):
            self.state["verification"] = {
                "user_id": parameters[0],
                "code_hash": parameters[1],
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
                "attempts": 0,
            }
            return FakeResult({"user_id": parameters[0]})
        if sql.startswith("select u.id") and "join email_verification_codes" in sql:
            user = self.state["user"]
            verification = self.state["verification"]
            if not user or not verification or user["email"] != parameters[0]:
                return FakeResult()
            return FakeResult({**user, **verification})
        if sql.startswith("select u.id") and "from auth_sessions" in sql:
            session = self.state["sessions"].get(parameters[0])
            user = self.state["user"]
            if (
                session
                and session["expires_at"] > datetime.now(timezone.utc)
                and user
                and user["email_verified_at"]
                and user["suspended_at"] is None
            ):
                return FakeResult(user.copy())
            return FakeResult()
        if sql.startswith("update email_verification_codes set attempts"):
            self.state["verification"]["attempts"] += 1
            return FakeResult(rowcount=1)
        if sql.startswith("update users set email_verified_at"):
            self.state["user"]["email_verified_at"] = datetime.now(timezone.utc)
            return FakeResult(rowcount=1)
        if sql.startswith("delete from email_verification_codes"):
            self.state["verification"] = None
            return FakeResult(rowcount=1)
        if (
            sql.startswith("select id, display_name, username, email, bio, interests,")
            and "password_hash" in sql
        ):
            user = self.state["user"]
            return FakeResult(user.copy() if user and user["email"] == parameters[0] else None)
        if sql.startswith("select id, display_name, email from users"):
            user = self.state["user"]
            if user and user["email"] == parameters[0] and not user["email_verified_at"]:
                return FakeResult({
                    "id": user["id"],
                    "display_name": user["display_name"],
                    "email": user["email"],
                })
            return FakeResult()
        if sql.startswith("update users set display_name"):
            user = self.state["user"]
            if not user or user["id"] != parameters[4] or not user["email_verified_at"]:
                return FakeResult()
            user.update({
                "display_name": parameters[0],
                "username": parameters[1],
                "bio": parameters[2],
                "interests": parameters[3],
            })
            return FakeResult(user.copy())
        if sql.startswith("update users set profile_visible"):
            user = self.state["user"]
            if not user or user["id"] != parameters[2] or not user["email_verified_at"]:
                return FakeResult()
            user["profile_visible"] = parameters[0]
            user["discoverable"] = parameters[1]
            return FakeResult({
                "profile_visible": user["profile_visible"],
                "discoverable": user["discoverable"],
            })
        if sql.startswith("update users set profile_image_url"):
            user = self.state["user"]
            if not user or user["id"] != parameters[1] or not user["email_verified_at"]:
                return FakeResult()
            user["profile_image_url"] = parameters[0]
            return FakeResult(user.copy())
        if sql.startswith("insert into auth_sessions"):
            self.state["sessions"][parameters[0]] = {
                "user_id": parameters[1],
                "expires_at": parameters[2],
            }
            return FakeResult(rowcount=1)
        if sql.startswith("delete from auth_sessions where expires_at"):
            now = datetime.now(timezone.utc)
            self.state["sessions"] = {
                token: session
                for token, session in self.state["sessions"].items()
                if session["expires_at"] > now
            }
            return FakeResult(rowcount=1)
        if sql.startswith("delete from auth_sessions"):
            self.state["sessions"].pop(parameters[0], None)
            return FakeResult(rowcount=1)
        if sql.startswith("select birth_date from dating_profiles"):
            profile = self.state["dating_profiles"].get(str(parameters[0]))
            return FakeResult({"birth_date": profile["birth_date"]} if profile else None)
        if sql.startswith("select profile.user_id, profile.birth_date") and "from dating_profiles profile" in sql:
            profile = self.state["dating_profiles"].get(str(parameters[0]))
            user = self.state["user"]
            return FakeResult({
                **profile,
                "display_name": user["display_name"],
                "username": user["username"],
            } if profile and user else None)
        if sql.startswith("insert into dating_profiles"):
            user_id, birth_date, gender, seeking, location, bio, interests, image_urls, active = parameters
            profile = {
                "user_id": str(user_id),
                "birth_date": birth_date,
                "gender": gender,
                "seeking": seeking,
                "location": location,
                "bio": bio,
                "interests": interests,
                "image_urls": image_urls,
                "active": active,
            }
            self.state["dating_profiles"][str(user_id)] = profile
            return FakeResult(rowcount=1)
        if sql.startswith("select plan.id") and "from savings_plans plan" in sql:
            plans = []
            for plan in self.state["savings_plans"].values():
                if plan["user_id"] != str(parameters[0]):
                    continue
                saved_amount = sum(
                    item["amount"] for item in self.state["savings_contributions"]
                    if item["plan_id"] == plan["id"] and item["user_id"] == plan["user_id"]
                )
                plans.append({**plan, "saved_amount": saved_amount})
            return FakeResult(rows=plans)
        if sql.startswith("insert into savings_plans"):
            user_id, name, target_amount, contribution_amount, frequency, target_date = parameters
            plan = {
                "id": str(uuid4()),
                "user_id": str(user_id),
                "name": name,
                "target_amount": target_amount,
                "contribution_amount": contribution_amount,
                "frequency": frequency,
                "target_date": target_date,
                "active": True,
                "created_at": datetime.now(timezone.utc),
            }
            self.state["savings_plans"][plan["id"]] = plan
            return FakeResult({key: value for key, value in plan.items() if key != "user_id"})
        if sql.startswith("insert into savings_contributions"):
            amount, note, plan_id, user_id = parameters
            plan = self.state["savings_plans"].get(str(plan_id))
            if not plan or plan["user_id"] != str(user_id) or not plan["active"]:
                return FakeResult()
            contribution = {
                "id": str(uuid4()),
                "plan_id": str(plan_id),
                "user_id": str(user_id),
                "amount": amount,
                "note": note,
                "contributed_at": datetime.now(timezone.utc),
            }
            self.state["savings_contributions"].append(contribution)
            return FakeResult({key: value for key, value in contribution.items() if key != "user_id"})
        if sql.startswith("select id from savings_plans"):
            plan = self.state["savings_plans"].get(str(parameters[0]))
            return FakeResult({"id": plan["id"]} if plan and plan["user_id"] == str(parameters[1]) else None)
        if sql.startswith("select id, amount, note, contributed_at from savings_contributions"):
            plan_id, user_id, limit = parameters
            rows = [
                {key: value for key, value in item.items() if key not in {"plan_id", "user_id"}}
                for item in self.state["savings_contributions"]
                if item["plan_id"] == str(plan_id) and item["user_id"] == str(user_id)
            ]
            return FakeResult(rows=list(reversed(rows))[:limit])
        if sql.startswith("select 1"):
            return FakeResult({"?column?": 1})
        raise AssertionError("Unexpected database query: {}".format(query))

    def _social_post_row(self, post, viewer_id):
        user = self.state["user"]
        return {
            "id": post["id"],
            "body": post["body"],
            "image_urls": post["image_urls"],
            "created_at": post["created_at"],
            "author_id": user["id"],
            "display_name": user["display_name"],
            "username": user["username"],
            "author_image_url": user.get("profile_image_url"),
            "like_count": sum(like[0] == post["id"] for like in self.state["likes"]),
            "comment_count": sum(comment["post_id"] == post["id"] for comment in self.state["comments"]),
            "liked_by_me": (post["id"], viewer_id) in self.state["likes"],
            "bookmarked_by_me": (post["id"], viewer_id) in self.state["bookmarks"],
        }

    def _video_row(self, video):
        user = self.state["user"]
        return {
            **video,
            "display_name": user["display_name"],
            "username": user["username"],
            "profile_image_url": user.get("profile_image_url"),
        }

    def _marketplace_product_row(self, product):
        user = self.state["user"]
        return {
            "id": product["id"],
            "name": product["name"],
            "category": product["category"],
            "price": product["price"],
            "stock": product["stock"],
            "description": product["description"],
            "image_url": product["image_url"],
            "image_urls": product["image_urls"],
            "created_at": product["created_at"],
            "seller_id": user["id"],
            "seller_name": user["display_name"],
            "seller_username": user["username"],
        }

    def _status_row(self, status, viewer_id=None):
        user = self.state["user"]
        views = [view for view in self.state["status_views"] if view["status_id"] == status["id"]]
        return {
            **status,
            "display_name": user["display_name"],
            "username": user["username"],
            "profile_image_url": user.get("profile_image_url"),
            "viewed_by_me": any(view["viewer_id"] == str(viewer_id) for view in views),
            "is_mine": status["user_id"] == str(viewer_id),
            "view_count": len(views),
        }

    def _local_marketplace_listing_row(self, listing):
        user = self.state["user"]
        return {
            "id": listing["id"],
            "category": listing["category"],
            "title": listing["title"],
            "price": listing["price"],
            "location": listing["location"],
            "detail": listing["detail"],
            "description": listing["description"],
            "image_url": listing["image_url"],
            "created_at": listing["created_at"],
            "seller_id": user["id"],
            "seller_name": user["display_name"],
            "seller_username": user["username"],
        }

    def _community_row(self, community, viewer_id):
        return {
            "id": community["id"],
            "owner_id": community["owner_id"],
            "name": community["name"],
            "description": community["description"],
            "created_at": community["created_at"],
            "owner_name": self.state["user"]["display_name"],
            "owner_username": self.state["user"]["username"],
            "member_count": sum(
                membership[0] == community["id"]
                for membership in self.state["community_memberships"]
            ),
            "joined_by_me": (community["id"], str(viewer_id)) in self.state["community_memberships"],
            "image_url": community.get("image_url"),
            "rules": community.get("rules", ""),
            "members_can_post": community.get("members_can_post", True),
            "membership_mode": community.get("membership_mode", "open"),
            "is_admin": community["owner_id"] == str(viewer_id),
            "join_requested_by_me": self.state["community_join_requests"].get(
                (community["id"], str(viewer_id)), {}
            ).get("status") == "pending",
            "pending_request_count": sum(
                key[0] == community["id"] and request["status"] == "pending"
                for key, request in self.state["community_join_requests"].items()
            ),
        }

    def _admin_user_row(self):
        user = self.state["user"]
        return {
            "id": user["id"],
            "display_name": user["display_name"],
            "username": user["username"],
            "email": user["email"],
            "bio": user["bio"],
            "interests": user["interests"],
            "profile_image_url": user.get("profile_image_url"),
            "profile_visible": user["profile_visible"],
            "discoverable": user["discoverable"],
            "email_verified_at": user["email_verified_at"],
            "suspended_at": user["suspended_at"],
            "created_at": user["created_at"],
            "updated_at": user["updated_at"],
            "posts": 0,
            "comments": 0,
            "messages": 1,
            "products": 0,
            "local_listings": 0,
            "jobs": 0,
            "applications": 0,
        }

    def _social_comment_row(self, comment):
        user = self.state["user"]
        return {
            "id": comment["id"],
            "body": comment["body"],
            "created_at": comment["created_at"],
            "parent_comment_id": comment.get("parent_comment_id"),
            "author_id": user["id"],
            "display_name": user["display_name"],
            "username": user["username"],
            "author_image_url": user.get("profile_image_url"),
        }


class FakePool:
    def __init__(self):
        self.state = {
            "user": None,
            "business_profiles": {},
            "verification": None,
            "sessions": {},
            "posts": [],
            "videos": [],
            "products": [],
            "statuses": [],
            "status_views": [],
            "local_listings": [],
            "communities": [],
            "community_memberships": set(),
            "community_join_requests": {},
            "community_posts": [],
            "admin_audit": [],
            "admin_roles": {},
            "admin_role_lookups": 0,
            "dating_profiles": {},
            "savings_plans": {},
            "savings_contributions": [],
            "likes": set(),
            "bookmarks": set(),
            "comments": [],
            "posting_usage": [],
            "free_monthly_limits": {
                "jobs": 100, "products": 100, "marketplace": 100, "videos": 100,
            },
        }

    @contextmanager
    def connection(self):
        yield FakeConnection(self.state)


class AuthFlowTests(unittest.TestCase):
    def setUp(self):
        self.pool = FakePool()
        self.delivered_code = ""

        def send_email(email, _name, code):
            self.assertEqual(email, "new@example.com")
            self.delivered_code = code

        settings = Settings(
            app_origin="http://localhost:5173",
            api_host="127.0.0.1",
            api_port=10000,
            database_url="postgresql://test:test@localhost/test",
            email_from="",
            environment="development",
            otp_hash_secret="test-otp-secret-that-is-long-enough",
            production=False,
            resend_api_key="",
            session_max_age_days=7,
            session_secret="test-session-secret-that-is-long-enough",
            trust_proxy=0,
            admin_emails=frozenset({"new@example.com"}),
        )
        self.media_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.media_tmp.cleanup)
        self.settings = settings
        self.client = TestClient(create_app(
            settings=settings,
            pool=self.pool,
            send_otp_email=send_email,
            media_directory=Path(self.media_tmp.name),
        ))

    def authenticate_test_user(self):
        signup = self.client.post("/api/auth/register", json={
            "name": "New User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

    def test_resend_request_identifies_the_api_client(self):
        settings = Settings(
            app_origin="https://www.iconnectdworld.com",
            api_host="127.0.0.1",
            api_port=10000,
            database_url="postgresql://localhost/test",
            email_from="iConnect <no-reply@mail.iconnectdworld.com>",
            environment="production",
            otp_hash_secret="test-otp-secret-that-is-long-enough",
            production=True,
            resend_api_key="test-resend-key",
            session_max_age_days=7,
            session_secret="test-session-secret-that-is-long-enough",
            trust_proxy=1,
            admin_emails=frozenset(),
        )
        with patch("server.app.main.urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.status = 200
            _send_otp_email(
                "recipient@example.com",
                "<Test User>",
                "123456",
                settings,
                logging.getLogger("test"),
            )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "iConnect-API/1.0")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertIn("You’re almost home, &lt;Test User&gt;.", payload["html"])
        self.assertIn("YOUR VERIFICATION CODE", payload["html"])
        self.assertIn(">123456</div>", payload["html"])
        self.assertIn("expires in 10 minutes", payload["html"])

    def test_signup_verify_login_profile_and_logout(self):
        invalid_signup = self.client.post("/api/auth/register", json={
            "name": "New User",
            "email": "new@example.com",
            "password": "short",
        })
        self.assertEqual(invalid_signup.status_code, 400)
        self.assertEqual(invalid_signup.json()["error"]["code"], "invalid_input")

        signup = self.client.post("/api/auth/register", json={
            "name": " New User ",
            "email": "New@Example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertRegex(self.delivered_code, r"^\d{6}$")
        self.assertEqual(
            self.pool.state["verification"]["code_hash"],
            hash_email_code(self.delivered_code, "test-otp-secret-that-is-long-enough"),
        )
        self.assertNotEqual(self.pool.state["verification"]["code_hash"], self.delivered_code)

        unverified_login = self.client.post("/api/auth/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(unverified_login.status_code, 403)

        invalid_code = "000000" if self.delivered_code != "000000" else "000001"
        failed_verify = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": invalid_code,
        })
        self.assertEqual(failed_verify.status_code, 400)
        self.assertEqual(self.pool.state["verification"]["attempts"], 1)

        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["user"]["name"], "New User")
        self.assertIn("iconnect.sid", verified.headers["set-cookie"])

        current_user = self.client.get("/api/auth/me")
        self.assertEqual(current_user.status_code, 200)
        self.assertEqual(current_user.json()["user"]["username"], "new")
        self.assertTrue(current_user.json()["user"]["profileVisible"])
        privacy = self.client.put("/api/auth/preferences", json={
            "profile_visible": False,
            "discoverable": False,
        })
        self.assertEqual(privacy.status_code, 200)
        self.assertFalse(privacy.json()["preferences"]["profileVisible"])
        self.assertFalse(self.client.get("/api/auth/me").json()["user"]["discoverable"])

        profile = self.client.put("/api/auth/profile", json={
            "name": "Updated User",
            "username": "updated.user",
            "bio": "A short intro",
            "interests": ["Design"],
        })
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["user"]["name"], "Updated User")
        self.assertFalse(profile.json()["user"]["profileVisible"])

        bad_login = self.client.post("/api/auth/login", json={
            "email": "new@example.com",
            "password": "incorrect password",
        })
        self.assertEqual(bad_login.status_code, 401)

        login = self.client.post("/api/auth/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.pool.state["admin_role_lookups"], 0)
        logout = self.client.post("/api/auth/logout")
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    def test_savings_tracking_and_adult_dating_profile_privacy(self):
        self.authenticate_test_user()
        plan_response = self.client.post("/api/savings/plans", json={
            "name": "Emergency fund",
            "target_amount": 500000,
            "contribution_amount": 10000,
            "frequency": "weekly",
            "target_date": (date.today() + timedelta(days=30)).isoformat(),
        })
        self.assertEqual(plan_response.status_code, 201, plan_response.text)
        plan_id = plan_response.json()["plan"]["id"]
        self.assertEqual(plan_response.json()["plan"]["saved_amount"], 0)

        contribution = self.client.post(
            "/api/savings/plans/{}/contributions".format(plan_id),
            json={"amount": 10000, "note": "First entry"},
        )
        self.assertEqual(contribution.status_code, 201, contribution.text)
        self.assertEqual(contribution.json()["contribution"]["amount"], 10000)
        plans = self.client.get("/api/savings/plans").json()["plans"]
        self.assertEqual(plans[0]["saved_amount"], 10000)
        history = self.client.get(
            "/api/savings/plans/{}/contributions".format(plan_id)
        ).json()["contributions"]
        self.assertEqual(len(history), 1)

        photo_url = "/api/media/images/{}.webp".format("a" * 32)
        underage = date.today().replace(year=date.today().year - 17).isoformat()
        profile_data = {
            "birth_date": underage,
            "gender": "woman",
            "seeking": "everyone",
            "location": "Lagos",
            "bio": "I enjoy reading and music.",
            "interests": ["Reading"],
            "image_urls": [photo_url],
            "active": True,
            "agree_to_adult_terms": True,
        }
        rejected = self.client.put("/api/dating/profile", json=profile_data)
        self.assertEqual(rejected.status_code, 403, rejected.text)
        self.assertEqual(rejected.json()["error"]["code"], "adult_only")

        profile_data["birth_date"] = date.today().replace(year=date.today().year - 18).isoformat()
        accepted = self.client.put("/api/dating/profile", json=profile_data)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        public_profile = accepted.json()["profile"]
        self.assertEqual(public_profile["age"], 18)
        self.assertNotIn("birth_date", public_profile)
        self.assertNotIn("birthDate", public_profile)
        self.assertEqual(self.client.get("/api/dating/profile").json()["profile"]["age"], 18)

    def test_signed_in_members_upload_images_for_posts_and_products(self):
        image_buffer = BytesIO()
        Image.new("RGB", (4, 4), (70, 120, 180)).save(image_buffer, format="PNG")
        image_bytes = image_buffer.getvalue()
        webp_buffer = BytesIO()
        Image.new("RGB", (4, 4), (120, 70, 180)).save(webp_buffer, format="WEBP")
        webp_bytes = webp_buffer.getvalue()
        unauthenticated = self.client.post(
            "/api/media/images",
            content=image_bytes,
            headers={"Content-Type": "image/png"},
        )
        self.assertEqual(unauthenticated.status_code, 401)

        signup = self.client.post("/api/auth/register", json={
            "name": "Media User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        first_upload = self.client.post(
            "/api/media/images",
            content=image_bytes,
            headers={"Content-Type": "image/png"},
        )
        second_upload = self.client.post(
            "/api/media/images",
            content=webp_bytes,
            headers={"Content-Type": "image/webp"},
        )
        self.assertEqual(first_upload.status_code, 201, first_upload.text)
        self.assertEqual(second_upload.status_code, 201, second_upload.text)
        image_urls = [first_upload.json()["url"], second_upload.json()["url"]]
        served_image = self.client.get(image_urls[0])
        self.assertEqual(served_image.status_code, 200)
        self.assertEqual(served_image.headers["content-type"], "image/webp")
        self.assertEqual(Image.open(BytesIO(served_image.content)).format, "WEBP")
        saved_photo = self.client.put(
            "/api/auth/profile/photo",
            json={"image_url": first_upload.json()["url"]},
        )
        self.assertEqual(saved_photo.status_code, 200, saved_photo.text)
        self.assertEqual(saved_photo.json()["user"]["image"], first_upload.json()["url"])
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["image"], first_upload.json()["url"])

        post = self.client.post(
            "/api/social/posts",
            json={"text": "A post with photos", "image_urls": image_urls},
        )
        self.assertEqual(post.status_code, 201, post.text)
        self.assertEqual(post.json()["post"]["imageUrls"], image_urls)
        self.assertEqual(self.client.get("/api/social/posts").json()["posts"][0]["imageUrls"], image_urls)

        product = self.client.post("/api/marketplace/products", json={
            "name": "Photo listing",
            "category": "Home",
            "price": 12000,
            "stock": 2,
            "description": "A listing with multiple photos",
            "image_urls": image_urls,
        })
        self.assertEqual(product.status_code, 201, product.text)
        self.assertEqual(product.json()["product"]["imageUrls"], image_urls)
        self.assertEqual(product.json()["product"]["imageUrl"], image_urls[0])
        product_id = product.json()["product"]["id"]
        listed_products = self.client.get("/api/marketplace/products")
        self.assertEqual(listed_products.status_code, 200, listed_products.text)
        self.assertEqual(listed_products.json()["products"][0]["imageUrls"], image_urls)
        product_details = self.client.get("/api/marketplace/products/{}".format(product_id))
        self.assertEqual(product_details.status_code, 200, product_details.text)
        self.assertEqual(product_details.json()["product"]["imageUrls"], image_urls)

    def test_rejects_invalid_image_upload_and_more_than_five_images(self):
        self.client.post("/api/auth/register", json={
            "name": "Media User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        invalid_images = self.client.post(
            "/api/media/images",
            content=b"not an image",
            headers={"Content-Type": "image/png"},
        )
        self.assertEqual(invalid_images.status_code, 400)
        post = self.client.post("/api/social/posts", json={
            "text": "Too many photos",
            "image_urls": ["/api/media/images/{}.png".format("a" * 32)] * 6,
        })
        self.assertEqual(post.status_code, 400)

    def test_signed_in_members_can_upload_watch_search_and_delete_videos(self):
        self.assertEqual(self.client.get("/api/videos").status_code, 401)
        unauthorized_upload = self.client.post(
            "/api/videos",
            content=b"\x00\x00\x00\x18ftypisomxxxx",
            headers={
                "Content-Type": "video/mp4",
                "X-Video-Title": "Unauthorized",
            },
        )
        self.assertEqual(unauthorized_upload.status_code, 401)

        signup = self.client.post("/api/auth/register", json={
            "name": "Video User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        invalid_video = self.client.post(
            "/api/videos",
            content=b"not a video",
            headers={
                "Content-Type": "video/mp4",
                "X-Video-Title": "Invalid",
            },
        )
        self.assertEqual(invalid_video.status_code, 400)
        self.assertEqual(invalid_video.json()["error"]["code"], "invalid_video")

        video_bytes = b"\x00\x00\x00\x18ftypisomxxxx"
        uploaded = self.client.post(
            "/api/videos",
            content=video_bytes,
            headers={
                "Content-Type": "video/mp4",
                "X-Video-Title": "Caf%C3%A9 walk",
                "X-Video-Caption": "A%20short%20clip",
            },
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        video = uploaded.json()["video"]
        self.assertEqual(video["title"], "Café walk")
        self.assertEqual(video["caption"], "A short clip")
        self.assertEqual(video["contentType"], "video/mp4")
        self.assertEqual(video["fileSize"], len(video_bytes))
        self.assertEqual(video["author"]["name"], "Video User")

        listed = self.client.get("/api/videos?view=mine&query=Caf%C3%A9")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([item["id"] for item in listed.json()["videos"]], [video["id"]])
        self.assertEqual(self.client.get("/api/videos?query=x").status_code, 400)

        playback = self.client.get(video["url"])
        self.assertEqual(playback.status_code, 200, playback.text)
        self.assertEqual(playback.headers["content-type"], "video/mp4")
        self.assertEqual(playback.content, video_bytes)

        deleted = self.client.delete("/api/videos/{}".format(video["id"]))
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get(video["url"]).status_code, 404)
        self.assertEqual(self.pool.state["videos"], [])

    def test_video_upload_enforces_stream_size_limit(self):
        self.client.post("/api/auth/register", json={
            "name": "Video User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })

        with patch("server.app.main.MAX_VIDEO_BYTES", 16):
            oversized = self.client.post(
                "/api/videos",
                content=iter((b"\x00\x00\x00\x18ftypisomxxxx!",)),
                headers={
                    "Content-Type": "video/mp4",
                    "X-Video-Title": "Too large",
                },
            )
        self.assertEqual(oversized.status_code, 413)
        self.assertEqual(self.pool.state["videos"], [])
        videos_directory = Path(self.media_tmp.name) / "videos"
        self.assertFalse(videos_directory.exists() and list(videos_directory.iterdir()))

    def test_rejects_foreign_origin_and_extra_fields(self):
        blocked = self.client.post(
            "/api/auth/register",
            headers={"Origin": "https://attacker.example"},
            json={"name": "Name", "email": "new@example.com", "password": "a long test password"},
        )
        self.assertEqual(blocked.status_code, 403)

        extra_field = self.client.post("/api/auth/register", json={
            "name": "Name",
            "email": "new@example.com",
            "password": "a long test password",
            "is_admin": True,
        })
        self.assertEqual(extra_field.status_code, 400)

    def test_allows_local_vite_origins_during_development(self):
        response = self.client.get(
            "/api/health",
            headers={"Origin": "http://127.0.0.1:5173"},
        )
        self.assertEqual(response.status_code, 200)

    def test_persistent_social_posts_likes_and_comments(self):
        self.assertEqual(self.client.get("/api/social/posts").status_code, 401)
        self.assertEqual(
            self.client.post("/api/social/posts", json={"text": "No session"}).status_code,
            401,
        )

        signup = self.client.post("/api/auth/register", json={
            "name": "Social User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        invalid_post = self.client.post("/api/social/posts", json={"text": "   "})
        self.assertEqual(invalid_post.status_code, 400)
        created = self.client.post("/api/social/posts", json={"text": "  A persistent update  "})
        self.assertEqual(created.status_code, 201, created.text)
        post = created.json()["post"]
        self.assertEqual(post["text"], "A persistent update")
        self.assertEqual(post["author"]["name"], "Social User")
        self.assertTrue(post["isMine"])
        self.assertEqual(post["likeCount"], 0)
        self.assertFalse(post["likedByMe"])
        self.assertFalse(post["bookmarkedByMe"])

        updated_post = self.client.put(
            "/api/social/posts/{}".format(post["id"]),
            json={"text": "Updated persistent update", "image_urls": []},
        )
        self.assertEqual(updated_post.status_code, 200, updated_post.text)
        self.assertEqual(updated_post.json()["post"]["text"], "Updated persistent update")
        self.assertTrue(updated_post.json()["post"]["isMine"])
        self.assertEqual(
            self.client.put(
                "/api/social/posts/00000000-0000-0000-0000-000000000002",
                json={"text": "No such post", "image_urls": []},
            ).status_code,
            404,
        )

        listed = self.client.get("/api/social/posts")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["posts"][0]["id"], post["id"])
        bookmark_url = "/api/social/posts/{}/bookmark".format(post["id"])
        self.assertEqual(
            self.client.put(bookmark_url, json={"bookmarked": True}).json(),
            {"bookmarked": True},
        )
        self.assertTrue(self.client.get("/api/social/posts").json()["posts"][0]["bookmarkedByMe"])
        bookmarked_posts = self.client.get("/api/social/posts?bookmarked_only=true").json()["posts"]
        self.assertEqual([item["id"] for item in bookmarked_posts], [post["id"]])
        self.assertEqual(
            self.client.put(bookmark_url, json={"bookmarked": False}).json(),
            {"bookmarked": False},
        )
        self.assertEqual(self.client.get("/api/social/posts?bookmarked_only=true").json()["posts"], [])
        self.assertEqual(self.client.get("/api/social/posts/00000000-0000-0000-0000-000000000002").status_code, 404)

        like_url = "/api/social/posts/{}/like".format(post["id"])
        liked = self.client.put(like_url, json={"liked": True})
        self.assertEqual(liked.json()["post"]["likeCount"], 1)
        self.assertTrue(liked.json()["post"]["likedByMe"])
        liked_again = self.client.put(like_url, json={"liked": True})
        self.assertEqual(liked_again.json()["post"]["likeCount"], 1)
        unliked = self.client.put(like_url, json={"liked": False})
        self.assertEqual(unliked.json()["post"]["likeCount"], 0)
        self.assertFalse(unliked.json()["post"]["likedByMe"])

        comments_url = "/api/social/posts/{}/comments".format(post["id"])
        invalid_comment = self.client.post(comments_url, json={"text": "  "})
        self.assertEqual(invalid_comment.status_code, 400)
        created_comment = self.client.post(comments_url, json={"text": "  A saved reply  "})
        self.assertEqual(created_comment.status_code, 201, created_comment.text)
        self.assertEqual(created_comment.json()["comment"]["text"], "A saved reply")
        parent_comment_id = created_comment.json()["comment"]["id"]
        nested_reply = self.client.post(comments_url, json={
            "text": "A reply to the comment",
            "parent_comment_id": parent_comment_id,
        })
        self.assertEqual(nested_reply.status_code, 201, nested_reply.text)
        self.assertEqual(nested_reply.json()["comment"]["parentCommentId"], parent_comment_id)
        self.assertEqual(
            self.client.post(comments_url, json={
                "text": "A reply nested too deeply",
                "parent_comment_id": nested_reply.json()["comment"]["id"],
            }).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(comments_url, json={
                "text": "Reply to a missing comment",
                "parent_comment_id": "00000000-0000-0000-0000-000000000002",
            }).status_code,
            404,
        )
        comments = self.client.get(comments_url)
        self.assertEqual(comments.status_code, 200)
        self.assertEqual(len(comments.json()["comments"]), 2)
        self.assertEqual(comments.json()["comments"][0]["text"], "A saved reply")
        refreshed = self.client.get("/api/social/posts/{}".format(post["id"]))
        self.assertEqual(refreshed.json()["post"]["commentCount"], 2)
        deleted = self.client.delete("/api/social/posts/{}".format(post["id"]))
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get("/api/social/posts/{}".format(post["id"])).status_code, 404)
        self.assertEqual(self.pool.state["comments"], [])

        other_user_post_id = str(uuid4())
        self.pool.state["posts"].append({
            "id": other_user_post_id,
            "user_id": "00000000-0000-0000-0000-000000000099",
            "body": "Another member's post",
            "image_urls": [],
            "created_at": datetime.now(timezone.utc),
        })
        other_user_post_url = "/api/social/posts/{}".format(other_user_post_id)
        self.assertEqual(
            self.client.put(other_user_post_url, json={"text": "Changed", "image_urls": []}).status_code,
            404,
        )
        self.assertEqual(self.client.delete(other_user_post_url).status_code, 404)
        self.assertEqual(len(self.pool.state["posts"]), 1)

    def test_admin_allowlist_user_details_private_messages_and_audit(self):
        self.assertEqual(self.client.get("/api/admin/overview").status_code, 401)
        signup = self.client.post("/api/auth/register", json={
            "name": "Admin User",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        rejected = self.client.post("/api/admin/login", json={
            "email": "new@example.com",
            "password": "wrong password",
        })
        self.assertEqual(rejected.status_code, 401)
        self.assertEqual(self.pool.state["admin_role_lookups"], 0)
        signed_in = self.client.post("/api/admin/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signed_in.status_code, 200, signed_in.text)
        self.assertEqual(signed_in.json()["admin"]["email"], "new@example.com")

        not_allowlisted = TestClient(create_app(
            settings=replace(self.settings, admin_emails=frozenset()),
            pool=self.pool,
        ))
        not_allowlisted.cookies.set("iconnect.sid", self.client.cookies.get("iconnect.sid"))
        self.assertEqual(not_allowlisted.get("/api/admin/me").status_code, 403)
        self.assertEqual(not_allowlisted.get("/api/admin/users").status_code, 403)

        overview = self.client.get("/api/admin/overview")
        self.assertEqual(overview.status_code, 200, overview.text)
        self.assertEqual(overview.json()["overview"]["users"], 1)
        self.assertEqual(overview.json()["overview"]["messages"], 1)
        users = self.client.get("/api/admin/users")
        self.assertEqual(users.status_code, 200, users.text)
        user = users.json()["users"][0]
        self.assertEqual(user["email"], "new@example.com")
        self.assertEqual(user["counts"]["messages"], 1)
        self.assertIn("profileImageUrl", user)
        self.assertNotIn("password_hash", user)

        details = self.client.get("/api/admin/users/{}".format(user["id"]))
        self.assertEqual(details.status_code, 200, details.text)
        message = details.json()["user"]["activity"]["messages"][0]
        self.assertEqual(message["text"], "Private test message")
        self.assertEqual(message["sender"]["username"], user["username"])
        self.assertEqual(message["recipient"]["username"], user["username"])
        self.assertEqual(message["imageUrl"], "/api/media/images/{}".format("f" * 32))
        self.assertEqual(details.json()["user"]["counts"]["messages"], 1)
        self.assertEqual(len(self.pool.state["admin_audit"]), 1)
        audit = self.client.get("/api/admin/audit-log")
        self.assertEqual(audit.status_code, 200, audit.text)
        self.assertEqual(audit.json()["events"][0]["action"], "view_user_details")
        self.assertEqual(
            self.client.get("/api/admin/users/00000000-0000-0000-0000-000000000002").status_code,
            404,
        )
        self.assertEqual(self.client.get("/api/admin/content?type=posts").status_code, 200)
        self.assertEqual(self.client.get("/api/admin/subadmins").json()["subAdmins"], [])
        self.assertEqual(
            self.client.post(
                "/api/admin/users/{}/suspension".format(user["id"]),
                json={"suspended": True},
            ).status_code,
            409,
        )

        uploaded_image = "/api/media/images/{}.webp".format("e" * 32)
        admin_product = self.client.post("/api/admin/products", json={
            "name": "Admin Home Lamp",
            "category": "Home",
            "price": 12500,
            "stock": 4,
            "description": "A member-facing sample product.",
            "image_urls": [uploaded_image],
            "published": True,
        })
        self.assertEqual(admin_product.status_code, 201, admin_product.text)
        self.assertEqual(admin_product.json()["product"]["imageUrl"], uploaded_image)
        self.assertEqual(
            self.client.get("/api/marketplace/products").json()["products"][0]["name"],
            "Admin Home Lamp",
        )

        admin_home = self.client.post("/api/admin/local-listings", json={
            "category": "Homes",
            "title": "Admin two-bedroom home",
            "price": "₦1,200,000 / year",
            "location": "Lagos",
            "detail": "Two bedrooms · Furnished",
            "description": "A home listing published by the admin.",
            "image_url": uploaded_image,
        })
        self.assertEqual(admin_home.status_code, 201, admin_home.text)
        self.assertEqual(admin_home.json()["listing"]["imageUrl"], uploaded_image)
        self.assertEqual(
            self.client.get("/api/local-marketplace/listings?category=Homes").json()["listings"][0]["title"],
            "Admin two-bedroom home",
        )

        admin_post = self.client.post("/api/admin/posts", json={
            "text": "An official update for our community.",
            "image_urls": [uploaded_image],
        })
        self.assertEqual(admin_post.status_code, 201, admin_post.text)
        self.assertEqual(admin_post.json()["post"]["text"], "An official update for our community.")
        self.assertEqual(admin_post.json()["post"]["imageUrls"], [uploaded_image])
        self.assertEqual(
            self.client.get("/api/social/posts").json()["posts"][0]["text"],
            "An official update for our community.",
        )
        member_post = self.client.post("/api/social/posts", json={
            "text": "My original member post",
            "image_urls": [uploaded_image],
        })
        member_post_id = member_post.json()["post"]["id"]
        edited_post = self.client.put(
            "/api/admin/posts/{}".format(member_post_id),
            json={
                "text": "Admin-edited member post",
                "image_urls": [uploaded_image],
            },
        )
        self.assertEqual(edited_post.status_code, 200, edited_post.text)
        self.assertEqual(edited_post.json()["post"]["text"], "Admin-edited member post")
        self.assertEqual(self.pool.state["posts"][-1]["body"], "Admin-edited member post")
        self.assertIn("edit_user_post", [event["action"] for event in self.pool.state["admin_audit"]])

        company_details = {
            "company_name": "Common Ground Ltd",
            "registration_number": "RC-1234567",
            "business_type": "Technology",
            "business_address": "Lagos, Nigeria",
            "contact_phone": "+2348012345678",
            "description": "A member company profile.",
        }
        cac_file = b"%PDF-1.7\nCAC registration record"
        company_submission = self.client.post(
            "/api/jobs/business-profile",
            content=cac_file,
            headers={
                "Content-Type": "application/pdf",
                "X-Company-Details": quote(json.dumps(company_details)),
            },
        )
        self.assertEqual(company_submission.status_code, 201, company_submission.text)
        self.assertEqual(company_submission.json()["businessProfile"]["companyName"], "Common Ground Ltd")
        member_profile = self.client.get("/api/jobs/business-profile")
        self.assertEqual(member_profile.status_code, 200, member_profile.text)
        self.assertEqual(member_profile.json()["businessProfile"]["registrationNumber"], "RC-1234567")
        own_cac = self.client.get("/api/jobs/business-profile/document")
        self.assertEqual(own_cac.status_code, 200)
        self.assertEqual(own_cac.content, cac_file)
        self.assertEqual(
            not_allowlisted.get(
                "/api/admin/users/{}/business-document".format(user["id"])
            ).status_code,
            403,
        )

        refreshed_details = self.client.get("/api/admin/users/{}".format(user["id"]))
        self.assertEqual(refreshed_details.status_code, 200, refreshed_details.text)
        self.assertEqual(refreshed_details.json()["user"]["businessProfile"]["contactPhone"], "+2348012345678")
        admin_cac_url = refreshed_details.json()["user"]["businessProfile"]["documentUrl"]
        admin_cac = self.client.get(admin_cac_url)
        self.assertEqual(admin_cac.status_code, 200)
        self.assertEqual(admin_cac.content, cac_file)
        self.assertIn("view_business_document", [event["action"] for event in self.pool.state["admin_audit"]])

        self.pool.state["admin_roles"][user["id"]] = {
            "created_by": user["id"],
            "created_at": datetime.now(timezone.utc),
        }
        role_lookups_before_login = self.pool.state["admin_role_lookups"]
        subadmin_login = not_allowlisted.post("/api/admin/login", json={
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(subadmin_login.status_code, 200, subadmin_login.text)
        self.assertEqual(self.pool.state["admin_role_lookups"], role_lookups_before_login + 1)
        self.assertEqual(subadmin_login.json()["admin"]["role"], "sub_admin")
        self.assertEqual(not_allowlisted.get("/api/admin/me").json()["admin"]["role"], "sub_admin")
        subadmin_details = not_allowlisted.get("/api/admin/users/{}".format(user["id"]))
        self.assertEqual(subadmin_details.status_code, 200, subadmin_details.text)
        self.assertEqual(
            subadmin_details.json()["user"]["activity"]["messages"][0]["text"],
            "Private test message",
        )
        self.assertEqual(not_allowlisted.get("/api/admin/subadmins").status_code, 403)

    def test_marketplace_product_listings_are_persistent(self):
        self.assertEqual(self.client.get("/api/marketplace/products").status_code, 401)
        self.assertEqual(
            self.client.post("/api/marketplace/products", json={
                "name": "Test item",
                "category": "Home",
                "price": 12000,
                "stock": 3,
                "description": "A test product",
            }).status_code,
            401,
        )

        signup = self.client.post("/api/auth/register", json={
            "name": "Shop Seller",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        verified = self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        })
        self.assertEqual(verified.status_code, 200)

        invalid_image = self.client.post("/api/marketplace/products", json={
            "name": "Test item",
            "category": "Home",
            "price": 12000,
            "stock": 3,
            "description": "A test product",
            "image_url": "javascript:alert(1)",
        })
        self.assertEqual(invalid_image.status_code, 400)
        created = self.client.post("/api/marketplace/products", json={
            "name": "  Handmade lamp ",
            "category": "Home",
            "price": 12000,
            "stock": 3,
            "description": "  A warm desk lamp. ",
            "image_url": "https://images.example.com/lamp.jpg",
        })
        self.assertEqual(created.status_code, 201, created.text)
        product = created.json()["product"]
        self.assertEqual(product["name"], "Handmade lamp")
        self.assertEqual(product["description"], "A warm desk lamp.")
        self.assertEqual(product["seller"]["name"], "Shop Seller")
        self.assertEqual(product["price"], 12000)
        self.assertEqual(product["stock"], 3)

        listed = self.client.get("/api/marketplace/products")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()["products"]], [product["id"]])
        category = self.client.get("/api/marketplace/products?category=Home")
        self.assertEqual(len(category.json()["products"]), 1)
        self.assertEqual(
            self.client.get("/api/marketplace/products/{}".format(product["id"])).json()["product"],
            product,
        )
        self.assertEqual(
            self.client.get("/api/marketplace/products/00000000-0000-0000-0000-000000000002").status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/marketplace/products?query=x").status_code,
            400,
        )
        updated = self.client.put(
            "/api/marketplace/products/{}".format(product["id"]),
            json={
                "name": "Updated lamp",
                "category": "Home",
                "price": 14000,
                "stock": 2,
                "description": "Updated product details.",
                "image_urls": [],
            },
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["product"]["name"], "Updated lamp")
        self.assertEqual(updated.json()["product"]["price"], 14000)
        self.assertEqual(updated.json()["product"]["imageUrls"], [])
        self.assertEqual(
            self.client.delete("/api/marketplace/products/{}".format(product["id"])).json(),
            {"deleted": True},
        )
        self.assertEqual(self.client.get("/api/marketplace/products").json()["products"], [])
        self.assertEqual(
            self.client.delete("/api/marketplace/products/{}".format(product["id"])).status_code,
            404,
        )

    def test_member_statuses_expire_and_are_removed_by_the_owner(self):
        signup = self.client.post("/api/auth/register", json={
            "name": "Status Member",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        }).status_code, 200)

        invalid = self.client.post("/api/statuses", json={
            "image_url": "javascript:alert(1)",
            "caption": "Not a valid status photo",
        })
        self.assertEqual(invalid.status_code, 400)
        posted = self.client.post("/api/statuses", json={
            "image_url": "/api/media/images/{}.webp".format("a" * 32),
            "caption": "A moment from today",
        })
        self.assertEqual(posted.status_code, 201, posted.text)
        status = posted.json()["status"]
        self.assertEqual(status["caption"], "A moment from today")
        self.assertTrue(status["isMine"])
        self.assertEqual(status["viewCount"], 0)
        self.assertEqual(status["author"]["username"], "new")

        expired = {
            **self.pool.state["statuses"][0],
            "id": str(uuid4()),
            "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
        }
        self.pool.state["statuses"].append(expired)
        listed = self.client.get("/api/statuses")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([item["id"] for item in listed.json()["statuses"]], [status["id"]])
        self.assertNotIn(expired, self.pool.state["statuses"])
        opened = self.client.get("/api/statuses/{}".format(status["id"]))
        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.json()["status"]["viewers"], [])
        self.assertEqual(
            self.client.delete("/api/statuses/{}".format(status["id"])).json(),
            {"deleted": True},
        )
        self.assertEqual(self.client.get("/api/statuses/{}".format(status["id"])).status_code, 404)

    def test_communities_are_persistent_and_membership_is_account_bound(self):
        self.assertEqual(self.client.get("/api/communities").status_code, 401)
        signup = self.client.post("/api/auth/register", json={
            "name": "Community Member",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        }).status_code, 200)

        invalid_community = self.client.post("/api/communities", json={
            "name": "  ",
            "description": "Description",
        })
        self.assertEqual(invalid_community.status_code, 400)
        created = self.client.post("/api/communities", json={
            "name": "  Local Makers ",
            "description": " A place for nearby designers and builders. ",
            "image_url": "/api/media/images/{}.webp".format("a" * 32),
            "rules": " Be kind and stay on topic. ",
        })
        self.assertEqual(created.status_code, 201, created.text)
        community = created.json()["community"]
        self.assertEqual(community["name"], "Local Makers")
        self.assertEqual(community["description"], "A place for nearby designers and builders.")
        self.assertEqual(community["imageUrl"], "/api/media/images/{}.webp".format("a" * 32))
        self.assertEqual(community["rules"], "Be kind and stay on topic.")
        self.assertTrue(community["membersCanPost"])
        self.assertTrue(community["isAdmin"])
        self.assertEqual(community["memberCount"], 1)
        self.assertTrue(community["joinedByMe"])
        self.assertNotIn("owner", community)
        stored_community = self.pool.state["communities"][0]
        self.assertEqual(stored_community["id"], community["id"])

        community_url = "/api/communities/{}".format(community["id"])
        group_detail = self.client.get(community_url)
        self.assertEqual(group_detail.status_code, 200, group_detail.text)
        self.assertEqual(group_detail.json()["community"]["ownerId"], community["ownerId"])
        updated_group = self.client.put(community_url, json={
            "name": "Local Makers Club",
            "description": "A member-led makers group.",
            "image_url": "/api/media/images/{}.webp".format("b" * 32),
            "rules": "Be kind. No spam.",
            "members_can_post": False,
        })
        self.assertEqual(updated_group.status_code, 200, updated_group.text)
        self.assertFalse(updated_group.json()["community"]["membersCanPost"])
        self.assertEqual(updated_group.json()["community"]["rules"], "Be kind. No spam.")
        stored_community["owner_id"] = "00000000-0000-0000-0000-000000000099"
        non_admin_update = self.client.put(community_url, json={
            "name": "Changed by member",
            "description": "This update should be rejected.",
            "rules": "",
            "members_can_post": True,
        })
        self.assertEqual(non_admin_update.status_code, 403)
        restricted_post = self.client.post(
            community_url + "/posts",
            json={"text": "Members cannot post while the creator restricts posting."},
        )
        self.assertEqual(restricted_post.status_code, 403, restricted_post.text)
        non_admin_remove = self.client.delete(
            community_url + "/members/00000000-0000-0000-0000-000000000098"
        )
        self.assertEqual(non_admin_remove.status_code, 403)
        stored_community["members_can_post"] = True
        member_post = self.client.post(community_url + "/posts", json={
            "text": "Hello from a member of this group.",
            "image_urls": ["/api/media/images/{}.webp".format("c" * 32)],
        })
        self.assertEqual(member_post.status_code, 201, member_post.text)
        self.assertEqual(member_post.json()["post"]["text"], "Hello from a member of this group.")
        self.assertTrue(member_post.json()["post"]["canDelete"])
        self.assertEqual(len(self.client.get(community_url + "/posts").json()["posts"]), 1)
        member_post_id = member_post.json()["post"]["id"]
        self.assertEqual(self.client.delete(community_url + "/posts/" + member_post_id).status_code, 204)

        stored_community["owner_id"] = self.pool.state["user"]["id"]
        owner_post = self.client.post(community_url + "/posts", json={"text": "Creator announcement."})
        self.assertEqual(owner_post.status_code, 201, owner_post.text)
        owner_post_id = owner_post.json()["post"]["id"]
        self.pool.state["community_posts"][0]["user_id"] = "00000000-0000-0000-0000-000000000098"
        self.assertEqual(self.client.delete(community_url + "/posts/" + owner_post_id).status_code, 204)
        members = self.client.get(community_url + "/members")
        self.assertEqual(members.status_code, 200, members.text)
        self.assertTrue(members.json()["members"][0]["isOwner"])
        self.assertEqual(
            self.client.delete(
                community_url + "/members/" + self.pool.state["user"]["id"]
            ).status_code,
            409,
        )

        listed = self.client.get("/api/communities?query=makers")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()["communities"]], [community["id"]])
        self.assertEqual(self.client.get("/api/communities?query=x").status_code, 400)

        stored_community["owner_id"] = "00000000-0000-0000-0000-000000000099"
        membership_url = "/api/communities/{}/membership".format(community["id"])
        stored_community["owner_id"] = self.pool.state["user"]["id"]
        owner_leave = self.client.put(membership_url, json={"joined": False})
        self.assertEqual(owner_leave.status_code, 409)
        stored_community["owner_id"] = "00000000-0000-0000-0000-000000000099"
        left = self.client.put(membership_url, json={"joined": False})
        self.assertEqual(left.status_code, 200)
        self.assertEqual(left.json()["community"]["memberCount"], 0)
        self.assertFalse(left.json()["community"]["joinedByMe"])
        joined = self.client.put(membership_url, json={"joined": True})
        self.assertTrue(joined.json()["community"]["joinedByMe"])
        self.assertEqual(joined.json()["community"]["memberCount"], 1)
        joined_again = self.client.put(membership_url, json={"joined": True})
        self.assertEqual(joined_again.json()["community"]["memberCount"], 1)
        left_again = self.client.put(membership_url, json={"joined": False})
        self.assertEqual(left_again.json()["community"]["memberCount"], 0)
        stored_community["owner_id"] = self.pool.state["user"]["id"]
        self.pool.state["community_memberships"].add(
            (community["id"], self.pool.state["user"]["id"])
        )
        approval_settings = self.client.put(community_url, json={
            "name": stored_community["name"],
            "description": stored_community["description"],
            "rules": stored_community["rules"],
            "members_can_post": True,
            "membership_mode": "approval",
        })
        self.assertEqual(approval_settings.status_code, 200, approval_settings.text)
        self.assertEqual(approval_settings.json()["community"]["membershipMode"], "approval")
        self.pool.state["community_memberships"].discard(
            (community["id"], self.pool.state["user"]["id"])
        )
        stored_community["owner_id"] = "00000000-0000-0000-0000-000000000099"
        request = self.client.put(membership_url, json={"joined": True})
        self.assertEqual(request.status_code, 200, request.text)
        self.assertTrue(request.json()["community"]["joinRequestedByMe"])
        self.assertFalse(request.json()["community"]["joinedByMe"])
        self.assertEqual(self.client.get(community_url + "/posts").status_code, 403)
        stored_community["owner_id"] = self.pool.state["user"]["id"]
        requests = self.client.get(community_url + "/join-requests")
        self.assertEqual(requests.status_code, 200, requests.text)
        self.assertEqual(len(requests.json()["requests"]), 1)
        approved = self.client.put(
            community_url + "/join-requests/{}".format(self.pool.state["user"]["id"]),
            json={"approved": True},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertTrue(self.client.get(community_url).json()["community"]["joinedByMe"])
        self.assertEqual(
            self.client.put(
                "/api/communities/00000000-0000-0000-0000-000000000002/membership",
                json={"joined": True},
            ).status_code,
            404,
        )

    def test_local_marketplace_listings_are_persistent(self):
        self.assertEqual(self.client.get("/api/local-marketplace/listings").status_code, 401)
        signup = self.client.post("/api/auth/register", json={
            "name": "Local Seller",
            "email": "new@example.com",
            "password": "a long test password",
        })
        self.assertEqual(signup.status_code, 202)
        self.assertEqual(self.client.post("/api/auth/verify-email", json={
            "email": "new@example.com",
            "code": self.delivered_code,
        }).status_code, 200)

        invalid_listing = self.client.post("/api/local-marketplace/listings", json={
            "category": "Homes",
            "title": "Sample apartment",
            "price": "₦2,400,000 / year",
            "location": "Lagos",
            "detail": "Two bedrooms",
            "description": "A test home.",
            "image_url": "http://images.example.com/home.jpg",
        })
        self.assertEqual(invalid_listing.status_code, 400)
        created = self.client.post("/api/local-marketplace/listings", json={
            "category": "Homes",
            "title": "  Bright apartment ",
            "price": "₦2,400,000 / year",
            "location": "Lagos",
            "detail": "Two bedrooms · Available now",
            "description": " A bright home near the city. ",
            "image_url": "/api/media/images/{}.webp".format("b" * 32),
        })
        self.assertEqual(created.status_code, 201, created.text)
        listing = created.json()["listing"]
        self.assertEqual(listing["title"], "Bright apartment")
        self.assertEqual(listing["description"], "A bright home near the city.")
        self.assertEqual(listing["seller"]["name"], "Local Seller")
        self.assertEqual(listing["imageUrl"], "/api/media/images/{}.webp".format("b" * 32))

        listed = self.client.get("/api/local-marketplace/listings?category=Homes&location=Lagos")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["id"] for item in listed.json()["listings"]], [listing["id"]])
        searched = self.client.get("/api/local-marketplace/listings?query=bright")
        self.assertEqual([item["id"] for item in searched.json()["listings"]], [listing["id"]])
        self.assertEqual(self.client.get("/api/local-marketplace/listings?query=x").status_code, 400)
        self.assertEqual(
            self.client.get("/api/local-marketplace/listings/{}".format(listing["id"])).json()["listing"],
            listing,
        )
        self.assertEqual(
            self.client.get("/api/local-marketplace/listings/00000000-0000-0000-0000-000000000002").status_code,
            404,
        )


if __name__ == "__main__":
    unittest.main()
