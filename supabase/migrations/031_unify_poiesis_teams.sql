-- Migration 031: Unifica Poiesis 1-6 em "poiesis" único
-- Poiesis 1..6 -> poiesis (idempotente, preserva demais teams)

DO $$
BEGIN
  -- clients
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='team') THEN
    UPDATE public.clients SET team='poiesis', updated_at=now() WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- pendencias
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pendencias' AND column_name='team') THEN
    UPDATE public.pendencias SET team='poiesis', updated_at=now() WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- operators
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operators' AND column_name='team') THEN
    UPDATE public.operators SET team='poiesis', updated_at=now() WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- visits
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='visits' AND column_name='team') THEN
    UPDATE public.visits SET team='poiesis', updated_at=now() WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- reunioes
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reunioes' AND column_name='team') THEN
    UPDATE public.reunioes SET team='poiesis', updated_at=now() WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- tickets (se existir)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tickets' AND column_name='team') THEN
    UPDATE public.tickets SET team='poiesis', updated_at=now() WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- client_devices
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_devices' AND column_name='team') THEN
    UPDATE public.client_devices SET team='poiesis' WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
  -- client_milvus_tickets
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='client_milvus_tickets' AND column_name='team') THEN
    UPDATE public.client_milvus_tickets SET team='poiesis' WHERE team IN ('poiesis_1','poiesis_2','poiesis_3','poiesis_4','poiesis_5','poiesis_6');
  END IF;
END $$;
