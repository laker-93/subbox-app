# What is Subbox?

Subbox is a cloud-based music library management platform designed specifically for DJs.

It allows users to:

* Upload and store their music collections in the cloud
* Stream their library across devices
* Manage playlists, cue points, and loops
* Sync and convert libraries between DJ software such as Serato and Rekordbox

Subbox uses a **Source → Cloud → Destination** model:

* Sources: Local DJ libraries (Serato, Rekordbox) or uploaded files
* Cloud: Centralised storage and metadata management
* Destinations: Export back to DJ software or download updated collections

Key capabilities:

* Metadata-first syncing (cue points, loops, playlists without reuploading audio)
* Automatic detection of library changes (delta sync)
* Per-user isolated music environments (Navidrome for streaming, Beets for organisation)
* Cross-platform access (desktop, web, mobile)

---

## How Subbox Differs from Feishin

Feishin is primarily a lightweight music player client for Navidrome/Subsonic servers.

Subbox extends this concept into a full DJ workflow platform:

### Subbox

* Music streaming client
* Connects to an existing server
* Focused on playback and browsing
* No library syncing or DJ metadata support

### Subbox

* Full cloud DJ library system
* Manages both audio files and DJ metadata
* Handles library syncing and conflict resolution
* Converts between DJ ecosystems (Serato ↔ Rekordbox)
* Includes backend orchestration (pymix) and per-user services

In short:

* Feishin = music player for different backends (navidrome, jelly fin)
* Subbox = cloud-based DJ library management + sync platform the backend server is always Navidrome


# Subbox Sync & Library UX Specification (Playlist-Driven Sync)

## Overview

This document defines the user experience and workflow design for Subbox's music library management.

Key goals:

* Separate **Library** from **Sync**
* Support large DJ collections
* Simplify syncing by using **playlists/crates as the only sync unit**
* Enable intuitive, DJ-native workflows

---

## Core Concept

Subbox operates on a:

### **Source → Cloud → Destination**

* **Source**: Serato, Rekordbox, local files
* **Cloud**: Subbox (audio + metadata)
* **Destination**: Export targets or local devices

---

## Core Principle (Updated)

> **If it’s in a playlist or crate, it can be synced.**

* Sync scopes are removed
* Playlists/crates are the only unit of sync
* Custom selections are handled via **Playlist Builder**

---

## UX Architecture

### Modes

#### 1. Library Mode (Default)

Purpose: Music browsing and organisation

Features:

* Track browsing
* Playlists
* Search
* Cue points and loops
* Streaming (via Navidrome)

Constraints:

* No upload/download UI clutter
* No sync actions

---

#### 2. Sync Mode (Dedicated Workspace)

Purpose: Data movement and management

Features:

* Sync playlists/crates
* Upload/download tracks
* Export libraries
* Storage management

---

## Desktop Application Design

### Navigation

* Library
* Sync
* Settings

---

## Sync Tab Specification

---

### Section 1: Sources (Import Into Subbox)

Each source is represented as a card:

* Serato
* Rekordbox
* Local Files

---

### Source Card Displays

* Source name
* Last sync timestamp
* Change summary:

  * New tracks
  * Metadata updates
* Playlist-based summary:

  * “3 playlists with changes”

---

### Actions

* `Sync Changes`
* `Select Playlists`

---

## Sync Flow (Upload)

### Step 1: User clicks `Sync Changes`

---

### Step 2: Select Playlists / Crates

User selects one or more playlists:

#### UI Displays:

* Playlist name
* Track count
* Optional:

  * “Already in cloud”
  * “Needs upload”

---

### Step 3: Preview Changes

Display:

* Total playlists selected
* Total tracks
* Tracks already in cloud
* New uploads required
* Metadata updates
* Storage impact

---

### Step 4: Confirm Sync

Action:

* `Sync Selected Playlists`

---

### Sync Behaviour (Upload)

* Only missing audio files are uploaded
* Duplicate files are skipped
* Metadata is always synced (cue points, loops, playlists)
* Delta detection is automatic
* Progress bar of upload or download displayed

---

## Section 2: Cloud Library Status

Displays:

* Storage used (e.g. 3.2 GB / 5 GB)
* Plan tier
* Breakdown:

  * Audio
  * Metadata

---

### Actions

* `Upgrade Storage`

---

## Section 3: Destinations (Download / Export)

Supports:

* Export to Rekordbox
* Export to Serato
* Download as ZIP
* Sync to local device

---

## Download / Export Flow

### Step 1: Select Playlists

User selects playlists from Subbox cloud.

---

### Step 2: Choose Format

* Rekordbox
* Serato
* ZIP

---

### Step 3: Preview

Display:

* Playlist count
* Track count
* Download size
* Already on device
* Files to download

---

### Step 4: Confirm

Action:

* `Download Selected Playlists`

---

### Sync Behaviour (Download)

* Only missing files are downloaded
* Existing files are skipped
* Metadata is updated locally
* Duplicate downloads are prevented

---

## Section 4: Activity Feed

Displays chronological actions:

* Uploads
* Metadata updates
* Exports

Purpose:

* Transparency
* User trust

---

## Playlist Builder (Replaces Custom Selection)

### Purpose

Enable users to create playlists for syncing without relying on external DJ software.

---

### Entry Points

* Sync page → `Create Playlist`
* Library → `New Playlist`
* Empty states

---

### Playlist Builder Features

* Search tracks by:

  * Name
  * Artist
* Results from:

  * Cloud library
  * Local indexed tracks (if available)

---

### Interaction Flow

1. User enters search query
2. Results appear instantly
3. User clicks:

   * `+ Add`
4. Tracks added to playlist

---

### Additional Features

* Drag-and-drop ordering
* Remove tracks
* Bulk add
* Real-time summary:

  * Track count
  * Estimated size

---

### Save Playlist

User inputs:

* Playlist name

Optional:

* Mark as:

  * Sync-enabled (future)

---

## Direct Playlist Actions

Playlists support:

* `Sync to Subbox`
* `Download to Device`
* `Export`

---

## Playlist Sync Indicators

Each playlist shows status:

* Synced
* Out of sync
* Not in cloud

---

## Web Application Design

### Purpose

* Lightweight access
* Quick uploads/downloads
* Library browsing

---

### Navigation

* Library
* Upload
* Sync Status
* Storage

---

## Upload Flow (Web)

### Upload Types

#### 1. Audio Upload

* Drag & drop
* ZIP upload
* Shows storage impact

---

#### 2. Metadata Upload

* Rekordbox XML
* Serato data

Purpose:

* Fast updates without audio upload

---

## Sync Status (Web)

Displays:

* Last sync timestamps
* Playlist sync states
* Storage usage

Constraints:

* Heavy sync actions handled in desktop

---

## Storage & Pricing Model

### Pricing

* Based on total audio storage
* Metadata is lightweight and always allowed

---

### Free Tier

* First 1 GB free

---

### At Storage Limit

Allowed:

* Metadata sync
* Library browsing
* Export

Blocked:

* Uploading new audio files

---

### UX Messaging

Instead of:

* “Storage limit reached”

Use:

* “You’ve run out of space for new tracks. You can still sync metadata.”

---

## Key UX Principles

### 1. Playlist-Driven Sync

* Playlists/crates are the only sync unit
* No separate sync abstraction exposed

---

### 2. DJ-Centric Design

Users think in:

* Sets
* Crates
* Playlists

---

### 3. Always Show Impact

Before actions, display:

* Track count
* File size

---

### 4. Smart Sync

* Skip duplicates
* Sync only missing files
* Always sync metadata

---

### 5. Reusable by Design

Playlists act as reusable sync definitions

---

## Example User Flows

---

### First-Time User

1. Connect Serato
2. Select playlists
3. Preview storage impact
4. Sync to cloud

---

### Returning User

1. Open Sync tab
2. See:

   * “+12 tracks”
   * “30 metadata updates”
3. Click `Sync Changes`

---

### Create Custom Sync Playlist

1. Click `Create Playlist`
2. Search and add tracks
3. Save playlist
4. Sync playlist

---

### Partial Library Workflow

User:

* Has 100GB library
* Selects 5 playlists (5GB)

Result:

* Faster sync
* Lower storage usage
* Better control

---

## Summary

Subbox separates:

* **Library** → browsing & organisation
* **Sync** → controlled data movement

With playlist-driven sync:

* Users stay in control of large collections
* Sync is intuitive and predictable
* System complexity is reduced
* UX aligns with real DJ workflows

---
