-- TASK-IDESC-RB-001: Add Trajectory ID to Episode Schema
-- Migration: 002_add_trajectory_id.sql
-- Purpose: Link DESC episodes to ReasoningBank trajectories
-- Implements: Integration between IDESC and ReasoningBank systems

-- ============================================================================
-- Add Trajectory ID Column
-- ============================================================================
-- Links episodes to ReasoningBank trajectories for outcome learning

ALTER TABLE episodes
ADD COLUMN trajectory_id TEXT;

-- ============================================================================
-- Add Reasoning Trace Column
-- ============================================================================
-- Stores summarized reasoning trace from ReasoningBank for context

ALTER TABLE episodes
ADD COLUMN reasoning_trace TEXT;

-- ============================================================================
-- Add Trajectory Linked Timestamp
-- ============================================================================
-- Records when the trajectory linkage was established

ALTER TABLE episodes
ADD COLUMN trajectory_linked_at TEXT;

-- ============================================================================
-- Create Index for Trajectory Lookups
-- ============================================================================
-- Optimize queries that filter by trajectory_id

CREATE INDEX IF NOT EXISTS idx_episodes_trajectory_id
ON episodes(trajectory_id)
WHERE trajectory_id IS NOT NULL;

-- ============================================================================
-- Create Index for Linked Episodes
-- ============================================================================
-- Optimize queries for linked vs unlinked episodes

CREATE INDEX IF NOT EXISTS idx_episodes_linked
ON episodes(trajectory_linked_at)
WHERE trajectory_linked_at IS NOT NULL;

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- 1. All columns are nullable to support existing episodes
-- 2. Indexes are partial (WHERE NOT NULL) for space efficiency
-- 3. trajectory_id references ReasoningBank's trajectory system
-- 4. reasoning_trace stores compressed/summarized reasoning for context injection
-- 5. trajectory_linked_at enables temporal analysis of linkage patterns
