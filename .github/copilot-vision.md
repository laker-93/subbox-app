# Subbox Sync & Library UX Specification

## Overview

This document defines the user experience and workflow design for Subbox's music library management, focusing on separating **library interaction** from **synchronization operations**.

The goal is to:

* Reduce UI clutter
* Improve user mental models
* Enable scalable workflows for large music collections
* Support storage-based pricing

---

## Core Concept

Subbox operates on a **Source → Cloud → Destination** model.

### Definitions

* **Source**: External systems or files (e.g. Serato, Rekordbox, local folders)
* **Cloud Library**: User’s centralised music and metadata stored in Subbox
* **Destination**: Export targets (e.g. Rekordbox, Serato, ZIP download)

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

* No upload/download UI elements
* No sync-related actions

---

#### 2. Sync Mode (Dedicated Workspace)

Purpose: All import/export/sync operations

Features:

* Import music and metadata
* Sync with DJ software
* Export libraries
* Storage management

---

## Desktop Application Design

### Navigation Structure

* Library
* Sync
* Storage (optional surface in Sync)
* Settings

---

## Sync Tab Specification (Desktop)

### Section 1: Sources (Import Into Subbox)

Each source is represented as a card.

#### Source Card Structure

* Source Name (e.g. Serato, Rekordbox, Local Folder)
* Last Synced Timestamp
* Detected Changes Summary:

  * New tracks
  * Updated metadata
  * Removed tracks

#### Actions

* `Sync Changes` (primary)
* `Full Resync` (secondary, optional)
* `Configure` (optional)

#### Behaviour

* System detects delta automatically
* Only changed data is uploaded
* Metadata-only updates are prioritised when possible

---

### Section 2: Cloud Library Status

Displays storage and plan usage.

#### Elements

* Total Storage Used (e.g. 3.2 GB / 5 GB)
* Plan Tier (Free / Paid)
* Breakdown:

  * Audio storage
  * Metadata storage

#### Actions

* `Upgrade Storage`

---

### Section 3: Destinations (Export From Subbox)

#### Destination Options

* Export to Rekordbox
* Export to Serato
* Download as ZIP
* Sync to Local Device

#### Destination Card Structure

* Destination Name
* Last Export Timestamp
* Pending Changes Indicator

#### Actions

* `Export Now`
* `Sync Changes`

---

### Section 4: Activity Feed

Chronological log of system actions.

#### Example Entries

* Uploaded 24 tracks
* Updated 120 cue points
* Exported library to Rekordbox

Purpose:

* Increase transparency
* Build user trust

---

## Web Application Design

### Purpose

* Lightweight access
* Quick uploads/downloads
* Library browsing

---

### Navigation Structure

* Library
* Upload
* Sync Status
* Storage

---

## Upload Flow (Web)

### Entry Points

* Upload button (global)
* Drag & drop anywhere
* Empty state prompts

---

### Upload Modal Structure

#### Section 1: Upload Music Files

* Drag & drop area
* File selection
* ZIP upload support

#### UI Feedback

* Upload progress bar
* Storage usage impact:

  * Example: "+320 MB"

---

#### Section 2: Upload Metadata Only

Supported Inputs:

* Rekordbox XML
* Serato metadata

#### Messaging

* Emphasise speed:

  * "Updates cues, loops, playlists without uploading audio files"

---

## Sync Status Page (Web)

### Purpose

Read-only visibility into sync state.

### Elements

* Last sync timestamps per source
* Pending changes summary
* Storage usage

### Constraints

* No heavy sync operations
* Prompt user to use desktop for full sync

---

## Download Flow (Web)

### Features

* Select:

  * Playlists
  * Full library

### Output Formats

* Rekordbox
* Serato
* ZIP archive

---

## Storage & Pricing Model

### Principles

* Pricing based on total stored audio size
* Metadata storage is lightweight and always allowed

---

### Free Tier

* Includes first 1 GB of storage

---

### Behaviour at Storage Limit

#### Allowed

* Metadata sync
* Library browsing
* Export existing files

#### Blocked

* Uploading new audio files

---

### UX Messaging

Instead of:

* "Storage limit reached"

Use:

* "You’ve run out of space for new tracks. You can still sync metadata."

---

### Storage Visibility

Displayed in:

* Sync Tab (Desktop)
* Upload Modal (Web)
* Settings / Storage Page

---

### Smart Prompts

#### During Upload

* "This upload will use 400 MB (80% of your plan)"

#### Near Limit

* "Upgrade to continue adding tracks to your library"

---

## Key UX Principles

### 1. Replace "Upload" with "Sync"

Preferred terminology:

* Sync Changes
* Import to Cloud
* Add to Library

Avoid:

* Upload (except in web context where unavoidable)

---

### 2. Metadata is First-Class

System should prioritise:

* Cue points
* Loops
* Playlists

Before:

* Audio file transfer

---

### 3. Show Deltas (Changes)

Before any sync, display:

* Number of new tracks
* Number of metadata updates
* Number of deletions

---

### 4. Prevent Redundant Uploads

System should:

* Detect existing files
* Skip duplicate uploads
* Suggest metadata-only sync where possible

---

## Example User Flows

### First-Time User (Desktop)

1. Open Sync tab
2. Connect Serato or Rekordbox
3. System scans library
4. Display:

   * Total tracks found
   * Storage required
5. User clicks `Sync to Cloud`

---

### Returning User

1. Open Sync tab
2. System shows:

   * "12 new tracks"
   * "34 updated cues"
3. User clicks `Sync Changes`

---

### Cross-Platform Workflow

1. Upload via desktop
2. Browse via web or mobile
3. Export via desktop

---

## Future Considerations

* Device-based sync targets
* Background sync scheduling
* Conflict resolution UI
* Selective sync (playlist-based)

---

## Summary

The system separates concerns into:

* **Library**: Consumption and organisation
* **Sync**: Data movement and transformation

This separation:

* Reduces cognitive load
* Improves scalability
* Aligns with user expectations of cloud-based systems

---
