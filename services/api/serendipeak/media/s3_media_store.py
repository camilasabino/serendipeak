import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from serendipeak.catalog.media.keys import require_media_key
from serendipeak.errors import InfrastructureError

PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable"

_MISSING_OBJECT_CODES = frozenset({"404", "NoSuchKey", "NotFound"})
# R2 accepts any region name and documents "auto". Timeouts bound a stalled connection so a
# request fails instead of hanging; standard retries cover throttling and transient 5xx
# responses, three attempts in total with backoff, which is safe because every write targets
# a content-addressed key and is checked before it is made.
_CLIENT_CONFIG = Config(
    region_name="auto",
    connect_timeout=5,
    read_timeout=60,
    retries={"mode": "standard", "total_max_attempts": 3},
)


def s3_client(*, endpoint_url: str, access_key_id: str, secret_access_key: str):
    return boto3.session.Session().client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=_CLIENT_CONFIG,
    )


class S3MediaStore:
    """Media in an S3-compatible object store, such as Cloudflare R2.

    Originals go to a private bucket and renditions to a public one. No ACLs are sent: bucket
    policy alone decides what is public.
    """

    def __init__(self, client, *, public_bucket: str, originals_bucket: str):
        self._client = client
        self._public_bucket = public_bucket
        self._originals_bucket = originals_bucket

    @classmethod
    def connect(
        cls,
        *,
        endpoint_url: str,
        access_key_id: str,
        secret_access_key: str,
        public_bucket: str,
        originals_bucket: str,
    ) -> "S3MediaStore":
        client = s3_client(
            endpoint_url=endpoint_url,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
        )

        return cls(client, public_bucket=public_bucket, originals_bucket=originals_bucket)

    def put_original(self, key: str, data: bytes, content_type: str) -> None:
        if self.has_original(key):
            return

        self._put(
            key,
            Bucket=self._originals_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def put_public(self, key: str, data: bytes, content_type: str) -> None:
        if self.has_public(key):
            return

        self._put(
            key,
            Bucket=self._public_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl=PUBLIC_CACHE_CONTROL,
        )

    def has_original(self, key: str) -> bool:
        return self._exists(self._originals_bucket, key)

    def has_public(self, key: str) -> bool:
        return self._exists(self._public_bucket, key)

    def read_original(self, key: str) -> bytes:
        require_media_key(key)

        try:
            response = self._client.get_object(Bucket=self._originals_bucket, Key=key)
            return response["Body"].read()
        except ClientError as error:
            if _is_missing(error):
                raise InfrastructureError(f"no original is stored under {key}") from error
            raise InfrastructureError(f"could not read the original {key}") from error
        except BotoCoreError as error:
            raise InfrastructureError(f"could not read the original {key}") from error

    def _exists(self, bucket: str, key: str) -> bool:
        require_media_key(key)

        try:
            self._client.head_object(Bucket=bucket, Key=key)
        except ClientError as error:
            if _is_missing(error):
                return False
            raise InfrastructureError(f"could not look up {key}") from error
        except BotoCoreError as error:
            raise InfrastructureError(f"could not look up {key}") from error

        return True

    def _put(self, key: str, **parameters) -> None:
        try:
            self._client.put_object(**parameters)
        except (ClientError, BotoCoreError) as error:
            raise InfrastructureError(f"could not store {key}") from error


def _is_missing(error: ClientError) -> bool:
    return error.response.get("Error", {}).get("Code") in _MISSING_OBJECT_CODES
