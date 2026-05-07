from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


@dataclass
class ImageResult:
    path: Path
    provider: str
    metadata: dict[str, Any]


@dataclass
class ReviewResult:
    ok: bool
    score: float
    failures: list[str]
    metadata: dict[str, Any]


class AvatarImageProvider(Protocol):
    name: str

    def generate_identity_anchor(self, job: dict[str, Any], out_dir: Path) -> ImageResult: ...
    def generate_state_anchor(self, job: dict[str, Any], state: str, identity_anchor: Path, out_dir: Path) -> ImageResult: ...
    def edit_frame_delta(self, job: dict[str, Any], state: str, frame_plan: dict[str, Any], source_image: Path, out_dir: Path) -> ImageResult: ...
    def review_contact_sheet(self, job: dict[str, Any], contact_sheet: Path, rubric: dict[str, Any]) -> ReviewResult: ...


def get_provider(name: str) -> AvatarImageProvider:
    if name == "mock":
        from .mock import MockAvatarImageProvider
        return MockAvatarImageProvider()
    if name in {"openai", "gpt-image-2", "gemini", "gemini-3.1-flash-image-preview"}:
        from .external_stub import ExternalAvatarImageProvider
        return ExternalAvatarImageProvider(name)
    if name == "none":
        raise ValueError("provider 'none' does not generate images; provide anchors or use provider 'mock' for offline fixtures")
    raise ValueError(f"unknown avatar image provider: {name}")
